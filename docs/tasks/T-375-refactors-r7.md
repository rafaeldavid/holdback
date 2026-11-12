# T-375: making hidden state explicit (package R7)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-358 (holdback PR 387, the two money addresses and domain 0.8), T-341 (the side-by-side harness and the state oracle), T-356 (the parent-commit harness), T-336 (the delivery liveness counter)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/`; `packages/settlement/evm/abis.json` where the ABI changes; one-line reads of the deal's word in `packages/`, `apps/` or `examples/` only if a change forces them; this task file. Never `formal/` (R4b), `docs/audit/` (AL-2), `spec/schemas/`, `site/`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, one reviewer per pull request, a target of 300k tokens for the package

## Intent

In my own words: the phase-one rules contract relies on facts it never names, or names in two places (the refinement plan's hidden-state findings IS-1 to IS-14, section 3.1). This package makes the ones that remain after the scope cuts explicit, so an auditor reads each fact once and the next change cannot get one copy wrong. Each change moves code without changing what any transaction does, and each is proven by the gates that compare the parent commit with the change. Two test improvements go first, because a gate strengthened after the changes proves nothing about them.

The one planned change of interface is RF-4: the deal's stored word gains its closing reason and its decider, so a reader of `dealOf` learns how a deal closed without replaying its events. The side-by-side harness's allow list names exactly that difference.

Non-goals: no fix of a known finding (that is R8); no NatSpec or names pass (R9); no change to a signed type, an event or `spec/schemas/`; no deploy; nothing merged to `main`.

**Trimmed by Rafa on 2026-11-12** ("Yes, trim them", relayed by the coordinator): the package is the five pull requests below, in this order.

- **RF-6, one close routine for early accept, settlement and refund: set aside.** It touches the money-moving paths for tidiness alone.
- **RF-5, explicit predicates: moved to R9,** the comments and names package. The Handoff lists the values it would name.

## Plan, per pull request

Line numbers are those of `contracts/src/HoldbackRules.sol` at `a37a48d`, the lane after holdback PR 387 [measured].

### PR 1: two gates made stronger (tests only; triage items 43 and 46)

- **Hidden state it answers:** none directly. It strengthens the gates that prove RF-2 (IS-2) and every later change.
- **What:** (a) a liveness counter for decisions. The handler counts every decision that lands after a delivery. It counts as a violation every decision it relays that is authorised and timely and still refused: the right key, the right role, the delivery the handler carried or posted, an outcome the role may give, before the role's deadline, with the beacon round already public. A new invariant requires that count to stay 0. (b) Boundary values in the handler's offers: one offer in 16 sits on a bound the contract checks today. The hold is at the largest `uint120` or one above; the escrow's expiry at the largest `uint48` or one above; or every deadline is one second after the one before, with a one-second escalation window.
- **Why no behaviour changes:** no file under `contracts/src/` changes.
- **Proof that each gate bites:** plant a bug in `contracts/src/`, run the gate, see it fail, remove the bug. For (a), the fallback's deadline swapped for `judgeBy`, so every fallback decision is refused: the existing invariants pass on it, the new invariant fails. For (b), the hold's bound written `>=` instead of `>`: the side-by-side harness fails on it with the boundary offers.

### PR 2: the three money functions with no caller (triage items 33 and 50)

- **Hidden state it answers:** none of IS-1 to IS-14. It removes code an auditor would list as dead: the bond arithmetic SC-7 left without a caller.
- **What:** `Money.requirement`, `Money.payout` and `Money.split` leave `HoldbackTypes.sol`, with the fuzz tests that fuzz them. `Money.ALL_BPS` stays.
- **Why no behaviour changes:** no code in `contracts/src/` calls them, so the compiler does not emit them. The proof is the compiled runtime bytecode of `HoldbackRules`, equal before and after once the metadata hash at its end is set aside.
- **Gates:** the bytecode comparison; the side-by-side harness with an empty allow list.

### PR 3: RF-4, the closing reason and the decider in the stored word

- **Hidden state it answers:** IS-3, one field with several meanings: `Refunded` has four causes (a reject, a reclaim, a default, and an escalation's reject), and `t1` is the decision, escalation or fallback time. With SC-7's cuts, an escalation reject and a default share one word although the fee went to different parties (`docs/audit/state-model.md` section 9.2). IS-4's appeal half left with SC-7.
- **What:** the word gains two fields in the bits it leaves free: `reason` (open, decided, accepted early, settled, reclaimed, defaulted) and `decider` (none, primary, fallback, appeal), as the state model's section 9.2 specifies. Each is written in the same storage write that closes the deal, and never changed after.
- **What changes, on purpose:** `dealOf` returns two more fields, so its ABI and `abis.json` change. Nothing else: no event, no refusal, no balance.
- **Gates:** the side-by-side harness with one allow-list entry, on the Words field only, where the new word is the old word plus the two fields. The state oracle reads the two fields from the chain and checks them against the handler's record of how each deal closed. Every invariant; `forge test`; the size.

### PR 4: RF-2, `decide` reads the deal's word once and writes it once

- **Hidden state it answers:** IS-2. `decide` holds the deal in memory while `_acceptDelivery` writes the same word in storage, then writes the memory copy back, with the attempt copied across by hand.
- **What:** `decide` loads the word into one local copy at the start, and every path stores it once, in `_firstInstance` or `_escalationDecision`, before any token moves. `_acceptDelivery` stops writing the word: it checks the delivery, stores its hash and returns it, and each caller sets the attempt in its own write. A view, `_turn`, returns whose turn it is, the deadline and the beacon round. The two closing helpers stay: a build that folded them into one block measured 409 bytes larger, against 36 bytes for this shape.
- **Why no behaviour changes:** every check runs in the same order with the same inputs, so every refusal has the same reason. The stored word after the call is the same, the events come in the same order, and the one write still comes before the first call that moves tokens.
- **One difference inside a call, and nowhere else:** in `Held`, while the adjudicator's signature and the beacon are checked, a contract signer or beacon that reads `dealOf` saw `Held` with attempt 1, a word no row of the state model allows. It now sees `Held` with attempt 0. No transaction's result depends on it, unless an ERC-1271 answer reads the rules contract in the middle of a call.
- **Gates:** the side-by-side harness with an empty allow list; the state oracle and every invariant; `forge test`; the runtime size before and after.

### PR 5: RF-3, each deadline in one place

- **Hidden state it answers:** the owner's rule 2, no fact in two places (plan section 1). The escalation's decision deadline is written out in `decide` and again in `triggerDefault`, and the two must agree for the opposing pair to split time at one instant (state model section 6.2). The fallback's beacon round is written out in `decide` and again in `triggerFallback`'s event.
- **What:** one internal function each for the escalation's decision deadline (`t1 + appealDecideSec`), the escrow's expiry (`fallbackBy + appealDecideSec + EXPIRY_MARGIN`), the fallback's beacon round and the escalation's beacon round. The plan's appeal deadline and appeal decision deadline left with party appeals (SC-7), so they are not built.
- **Why no behaviour changes:** each function returns the expression it replaces, in the same 256-bit arithmetic.
- **Gates:** as PR 4.

## Evidence

### PR 1 (holdback PR 396): the decision counter and the boundary offers

All runs are local `forge test` on 2026-11-12, from `contracts/`, with forge 1.0.0 [measured unless marked].

- **On unchanged source, before the review fixes** (`--match-path 'test/{invariant,differential}/*.t.sol'`): 49 passed, 0 failed, in 476 s. Among them: 11 invariants at 256 runs of 100 calls each, `invariant_timelyDecisionsLand` included; `testFuzz_sideBySide` at 256 runs; `test_sideBySide_reachesEveryRow`; 20 smoke tests, 3 of them new.
- **The decision counter catches a planted bug.** In `HoldbackRules.sol:257` the fallback's deadline became `t.timing.judgeBy`, so every fallback decision is late. `--match-path test/invariant/RulesInvariants.t.sol`: the 10 existing invariants passed, and `invariant_timelyDecisionsLand` failed with "decideFallback: an authorised, timely decision was refused: 1 != 0". The plant was removed (`git checkout`).
- **The boundary offers catch a planted bug.** In `HoldbackRules.sol:154` the hold's bound became `hold >= type(uint120).max`. With the lane's handler (`a37a48d`), `testFuzz_sideBySide` passed 257 runs. With this handler it failed on its first seed: "step 3, action agreeAndFund, field calls differs", seed 304292929107939. The plant was removed.
- **Runtime size of `HoldbackRules`:** 19,914 bytes, unchanged (no source change).
- **After the review fixes** (same command): 50 passed, 0 failed, in 294 s; `invariant_timelyDecisionsLand`, which now fails in both directions, passed 256 runs of 100 calls; `testFuzz_sideBySide` passed 257 runs; 21 smoke tests, 4 of them new.

### PR 1b (holdback PR 399): the zero-price tests restored

The coordinator relayed on 2026-11-12 that an earlier sync of `main` into the lane had dropped T-345's `contracts/test/unit/ZeroPrice.t.sol`; the lane never carried it. PR 1 had merged by the time the port was ready, so it is its own tests-only pull request. A subagent ported it to the phase-one contracts: 20 tests, 20 passed [measured by it]. It dropped one test (the unbonded primary, no vault since SC-7) and the Permit2 and `expireOffer` steps of another (SC-2, SC-6).

### PR 2: the three money functions with no caller

- **Compiled code unchanged** [measured, one `forge build`]: `HoldbackRules`' runtime is 19,914 bytes on both sides. Without the metadata hash at its end, the new code equals, byte for byte, the code compiled from `parent/HoldbackRules.a37a48d.sol`, the lane's source at `a37a48d`: 19,861 bytes each. (A first comparison against a saved artifact differed by 2 bytes; that artifact came from the planted build of PR 1's proof, so the parent's artifact in the same build is the baseline used.)
- **The harness's old side is re-seated** to `a37a48d`: `parent/` holds its three files unchanged (same git blob ids), the planted copy is rebuilt from it, `PinnedSource.t.sol` pins the new hashes, and the allow list is empty. The parent pays the money addresses, so the harness now draws deals with those addresses apart as the invariant campaign does.
- **Gates** (`--match-path 'test/{invariant,differential,fuzz}/*.t.sol'`): 61 passed, 1 failed, in 412 s. `testFuzz_sideBySide` passed 257 runs with the empty allow list; the 11 invariants passed 256 runs of 100 calls each; `test_planted_failsTheHarness` passed. The one failure was the harness's own reach floor: `test_sideBySide_reachesEveryRow` counted 571 landed calls over its 48 seeds against a floor of 576. It passed the run before, without deals drawn apart. The floor went from 12 to 11 a seed (528 of 571), after the review; every row and stage is still reached. Why deals drawn apart land fewer calls is not measured.
- **Removed with the functions:** `test/fuzz/Rounding.fuzz.t.sol` (7 fuzz tests, all of them on the three functions), their 7 lines in `.gas-snapshot`, and the `Rounding` entry in `contracts/README.md`. `Postings.fuzz.t.sol` now asserts the fee share of 0 directly.

### PR 3: RF-4, the closing reason and the decider in the word

- **What changed in `contracts/src`:** two enums, `Reason` and `Decider`, and two fields at the end of `Deal`. Each closing write sets them in the same statement as the stage: the primary's or fallback's accept or reject (`Decided`, `Primary` or `Fallback`), the escalation's decision (`Decided`, `Appeal`), `earlyAccept` (`AcceptedEarly`), `mutualSettle` (`Settled`), `reclaim` (`Reclaimed`) and `triggerDefault` (`Defaulted`), the last two through `_refundAll`'s new argument. An escalation leaves the reason `Open`. No event, check or token call moved.
- **Full suite** [measured, local `forge test`]: 57 suites, 417 tests passed, 0 failed, in 290 s. `testFuzz_sideBySide` passed 257 runs with the one RF-4 allow-list entry; `test_sideBySide_reachesEveryRow` landed 571 calls (the same as PR 2); the 11 invariants passed 256 runs of 100 calls, the state oracle now checking the stored reason and decider against the handler's record on every deal after every call.
- **Runtime size of `HoldbackRules`** [measured, artifact]: 19,914 bytes before, 20,504 bytes after, **590 bytes added**. The limit is 24,576 bytes, so 4,072 bytes remain.
- **`abis.json`** regenerated with `node scripts/evm-abis.mjs`: `dealOf`'s tuple gains `reason` and `decider` (`uint8`, the two enums). No other entry changed.

### PR 4: RF-2, `decide` reads the word once and writes it once

- **Full suite** [measured, local `forge test`, with the harness's parent re-seated to RF-4's source at `3b49cc0` and an empty allow list]: 57 suites, 417 tests passed, 0 failed. `testFuzz_sideBySide` passed 257 runs; `test_sideBySide_reachesEveryRow` landed 571 calls.
- **Runtime size of `HoldbackRules`** [measured, single-contract builds of the same source tree]: 20,504 bytes for RF-4 (the parent copy), 20,540 bytes with RF-2, **36 bytes added**. A first build that also folded `_firstInstance` and `_escalationDecision` into one closing block measured 20,940 bytes (409 added) and was not kept.

## Review

### PR 1

One reviewer pass (Opus 5.5, the `reviewer` role) on commit `9b0bf6c`, with CLAUDE.md, the state model and the code; it ran no forge. Verdict ISSUES: no false positive found in the predicate; two Medium, two Low, three Info. It also checked that neither fixed smoke seed draws a boundary offer [measured by it with `cast keccak`].

| Severity | Finding | Done |
| --- | --- | --- |
| Medium | The Evidence was empty | Filled in above |
| Medium | The gate could go quiet: a predicate that drifted to `false` everywhere would still pass | The handler now counts a disagreement in both directions: a timely decision refused, and a decision that landed although the predicate calls it untimely. A new smoke test forces a timely refusal (the escrow's capture mocked to revert) and sees the violation |
| Low | The predicate's comment said it reads nothing from the rules contract; the stage and `t1` come from the stored word | Comment corrected: the state oracle checks those two against its rows |
| Low | The one-second escalation window can never be decided on the sim beacon (finding F-2), so no appeal decision lands at its deadline | A sixth boundary kind with a two-second window, the smallest the sim beacon can decide; the comment names F-2 |
| Info | `fundBy > type(uint48).max` in `_paymentInfo` is unreachable since SC-5 | Handoff, for R8 |
| Info | Two comments inaccurate | Reworded |
| Info | The mints, the clock cap and the boundary offers hide nothing it could find | None needed |

### PR 1b

One reviewer pass on the port: PASS. No assertion weaker than main's for the same outcome, no outcome phase one keeps left uncovered, no vacuous check. Two Info notes on wording; the one about the deadline that refuses an expired offer (`offerExpiresAt`, before `fundBy`) is fixed.

### PR 2

One reviewer pass on commit `318b8e4`: PASS, three Low and three Info. It measured that no caller of the three functions remains, that `parent/` has `a37a48d`'s git blob ids, that `planted/` differs from it by exactly the stated edits, and that the compiled code is equal without its metadata.

| Severity | Finding | Done |
| --- | --- | --- |
| Low | A stale comment on `_paysMoneyAddresses`, now overridden nowhere | The hook and its check are removed |
| Low | The new reach floor was loose (480 against 571) and its cause unmeasured | Floor 11 a seed (528); the comment says the cause is not measured |
| Low | `docs/audit/` names the removed test and import | Handoff, for AL-2 |
| Info | `contracts/README.md` and `.gas-snapshot` are outside the listed paths | Both follow from the removal; kept |
| Info | Rounding is no longer fuzzed on chain | Phase one has no rate arithmetic on chain; `Postings` asserts the fee share of 0 |

## Decisions

- **The clock stays below 2^40 s in the handler.** The word stores times in 40 bits, and bounding them is R8's fix. Without the cap, a warp to a boundary offer's far deadline would let `t1` wrap and fail the oracle for a known, out-of-scope reason.
- **The boundary deal that holds the largest `uint120` funds.** The handler mints that amount to the buyer and the payment address at construction, so the capture and void at the top of the range run too. Conservation reads the supply after construction, so it counts them.

## Handoff

- **For AL-2 (`docs/audit/`), from PR 2:** `docs/audit/invariants.md` still lists `test/fuzz/Rounding.fuzz.t.sol`, which PR 2 removed; `docs/audit/scope.md` says the Holdback contracts import `FixedPointMathLib`, and since PR 2 no file in `contracts/src` does [measured by PR 2's reviewer].
- **For R8, from PR 1's review:** the clause `t.timing.fundBy > type(uint48).max` in `_paymentInfo` cannot be reached since SC-5, because `fundBy < fallbackBy <= expiry` [inferred]. R8 may drop it or keep it as a guard, and when it adds its own bounds it removes the handler's clock cap (`CLOCK_CAP`) and adds those bounds to `_boundary`.
