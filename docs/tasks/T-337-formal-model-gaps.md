# T-337: The formal model's gaps

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-204 (the model), T-206 (the contract review, §5 and I-11)
- **Paths this task may touch:** `formal/`, this task file, and row G-3 of `docs/audit/known-issues.md`
- **Human gate:** no
- **Status:** done (PR #331 merged 2026-11-11; one review, two Lows fixed on the branch: G-3 reads "fixed in part", and Handoff item 7 adds the `deliverBy`-after-expiry case for R4)
- **Agent/session:** implementer, pilot plan package C1c (change kind 7)

## Intent

The TLA+ model in `formal/Holdback.tla` leaves out two things the contracts do, and its README never maps the
model to the contract (known issue G-3; review §5 and I-11). This task closes those gaps in the model only.

- **The buyer's reclaim on Commerce Payments (CPP).** After CPP's `authorizationExpiry` the buyer can take the
  held funds back from CPP directly, outside `HoldbackRules`. The model gains that expiry as a clock step and the
  reclaim as a buyer action in any funded state. After it, no capture can happen, and the rules contract's
  timeouts still close the deal without paying the buyer a second time. Safety properties state that: no double
  payout, the escrow account matches CPP, every bond encumbered for the deal is released when the deal closes, and
  every funded deal still ends.
- **Bond coverage.** `HoldbackBonds` keeps a posted bond and an encumbered amount per adjudicator. The model gains
  the encumbered amount and the per-deal flags, with the contract's encumber, release and slash steps, and the
  coverage gate (a primary or fallback with too little free bond cannot fund or decide). Invariants state that
  encumbered never exceeds posted, that it equals the sum over open deals, and that a closed deal holds none.
- **The README's contract column.** Each model action and variable maps to the contract function, storage field
  and line in `contracts/src/` at HEAD.

Non-goals: no change to `contracts/src/` or any other lane; signatures stay abstract; L-3, L-5 and L-6 stay open and
are not modelled as fixed. A counterexample that matches a recorded issue becomes a documented `formal/broken/`
config; one that matches none is a finding.

## Context

- `docs/audit/known-issues.md` G-3, L-3, L-5, L-6; `docs/reviews/2026-11-03-contract-review.md` §5 and I-11.
- `contracts/src/HoldbackRules.sol`, `contracts/src/HoldbackBonds.sol`, `contracts/test/unit/AfterCppReclaim.t.sol`.
- CPP `AuthCaptureEscrow`: `capture` reverts from `authorizationExpiry`, `void` works while anything is held,
  `reclaim` is the payer's alone and only from `authorizationExpiry`.

## Acceptance criteria

- [x] The model has the CPP expiry, the buyer's CPP reclaim, and the rules contract's behaviour after it.
- [x] The model has free and encumbered bond per adjudicator, with the coverage gate, release and slash.
- [x] New safety properties hold in `safety.cfg`; each has a `broken/` config that shows it bites. The new liveness property `BondsFreed` holds in all seven `live-*.cfg` and has no broken config of its own.
- [x] L-6 is encoded as a documented `broken/` config, not as fixed.
- [x] The README's contract column names the function, storage field and line for every action and variable.
- [x] `formal/check.sh safety`, `formal/check.sh broken/` and the full run pass.
- [x] G-3 reads fixed in this PR.

## Out of scope

- Signatures, scopes and mandates; the Phase 4 economics; L-3 and L-5 (a minimum appeal bond, an appeal
  adjudicator's own bond).

## Evidence

- **`formal/check.sh` (full run, every config): exit 0, "all configs met expectations"** [measured, 2026-11-11, TLC 2.19
  from tla2tools v1.7.4, 8 workers, Apple silicon]. 8 configs pass, 12 broken configs bite, 0 fail.

  | config | result | distinct states | depth | wall |
  | --- | --- | ---: | ---: | ---: |
  | safety (10 invariants + 3 action properties) | pass | 132,339 | 31 | 6 s |
  | live-appeal | pass | 303,090 | 32 | 454 s |
  | live-beacon | pass | 301,548 | 32 | 212 s |
  | live-buyer | pass | 286,916 | 32 | 92 s |
  | live-fallback | pass | 327,248 | 32 | 138 s |
  | live-operator | pass | 328,790 | 32 | 137 s |
  | live-primary | pass | 322,108 | 32 | 98 s |
  | live-seller | pass | 292,056 | 32 | 129 s |
  | broken/keep-bond-after-cpp (new) | bites: `BondsReleasedAtClose` | 1,869 | 11 | 2 s |
  | broken/double-refund (new) | bites: `SettleOnce` | 1,395 | 11 | 2 s |
  | broken/capture-after-expiry (new) | bites: `NoCaptureAfterExpiry` | 3,351 | 14 | 2 s |
  | broken/slash-keeps-enc (new) | bites: `EncMatchesDeals` | 644 | 10 | 1 s |
  | broken/slash-uncovered (new) | bites: `BondCovered` | 2,850 | 13 | 1 s |
  | broken/late-judge-by (new; L-6) | bites: `ExpiryAfterCaptures` | 160 | 8 | 1 s |
  | the 6 existing broken configs | bite as before | 45 to 43,666 | 8 to 11 | 1 to 4 s |

- **The liveness configs took 1,260 s (21 min) together**, against about 11 min before [measured for this run; the
  11 min is CLAUDE.md's figure, guessed to be on a similar machine]. Broken counts vary between runs because the
  first violation found depends on worker scheduling (T-204).
- **The safety state space grew 23%**: 107,519 distinct states for the model at `origin/main` with its own
  `safety.cfg`, against 132,339 now [measured, same TLC and machine].
- **The CI subset passes**: `formal/check.sh safety` and `formal/check.sh broken/` ran before the full run with the
  same results [measured].
- **`git diff --stat origin/main -- contracts/src` prints nothing** [measured before each commit]. `formal/.tools/`
  stays ignored by `formal/.gitignore` and `git status` lists no generated file [measured].
- **The README's line numbers match `HoldbackRules.sol` and `HoldbackBonds.sol` at `26d4670`**, and CPP's at the
  pinned submodule `6b0a5ef` [inferred: read by hand, not tool-checked].

## Decisions

1. **The expiry is a clock step, tracked only while the deal is funded.** After a payout CPP holds nothing, so
   the expiry changes nothing and leaving it out keeps the state space small. With ordered deadlines the expiry
   comes after fallbackBy, so `TickExpiry` moves `clk` to 5 in Held, Delivered and FallbackJudging.
2. **`TickExpiry` and `CppReclaim` get no fairness.** Time may never reach the expiry, and the buyer is a named
   actor. The liveness properties then cover behaviours with and without a CPP reclaim.
3. **`EscrowMatchesState` now reads "funded and not reclaimed on CPP".** That is a refinement for the new step,
   not a weaker check: for every behaviour without a CPP reclaim it is the old invariant.
4. **The default compensation stays as `state.ts` has it.** The contract pays none (I-8). Removing it would
   change the existing model and the `mint` config.
5. **L-6 is a `broken/` config with a `Bug` value, not a model change.** The model's clock assumes ordered
   deadlines. `late_judge_by` lets the expiry pass in Delivered while the primary is on time, which is the one
   effect of L-6 on captures.
6. **Scope cut by the coordinator (2026-11-11).** Refinement package R4 brings the model level with a new state
   model and owns `formal/` after this task, so this PR lands what passes and lists the rest below.

## Handoff

Done: the buyer's CPP reclaim, the CPP expiry and its effect on captures and voids; posted and encumbered bond
with per-deal flags, the coverage gate, release and slash; six new properties, each with a `broken/` config that
bites; L-6 encoded in `broken/late-judge-by.cfg`; the README's action and variable mapping to the contract.

TLC found no counterexample outside the deliberately broken variants, so this task records no new finding
[measured: `safety` and the liveness configs pass].

For refinement package R4:

1. **The coverage gate never blocks.** Each adjudicator starts with 2 × price, enough for both commitments, so the
   `Free(a) >= Price` guards in `Fund` and `FirstInstance` are never false [inferred from the arithmetic, not
   measured]. A smaller initial bond needs a new `InitialTotal` and a decision on the default compensation, which
   `state.ts` pays from bonds without looking at the encumbrance.
2. **L-3 and L-5 are not modelled.** The appeal bond is a fixed 1 unit and the appeal adjudicator is never
   encumbered (`EncMatchesDeals` states the latter). Modelling a zero appeal bond and the appeal adjudicator's
   missing bond is R4's.
3. **L-6 liveness is not a config.** Under `late_judge_by` the deal should still close (the buyer reclaims on
   CPP, the timeouts release the bonds) [inferred, not run]. When T-212 item 4 fixes L-6, move
   `broken/late-judge-by.cfg` out of `broken/`.
4. **The model differs from the contract in shape**, documented in the README: Offer, AdjAccept and Agree are
   separate steps, where the contract checks all three signatures in `agreeAndFund`; a delivery carried by
   `decide` or `earlyAccept` is two model steps but one transaction; `earlyAccept` in Held is not modelled; the
   appeal fee and the default compensation exist in the model only (I-8).
5. **The line numbers are at `26d4670`.** T-334 cleans `contracts/src/` on `contracts-audit-ready`, so the README's
   lines drift when that merges. The mapping was read, not tool-checked.
6. **The liveness run is longer**: 21 min against about 11 min (Evidence). CI runs it on pushes to `main` only, and
   CLAUDE.md's "~11 min" is now out of date; that file is outside this task's paths.
7. **A `deliverBy` after the expiry is not modelled** (review, Low). `Holdback.tla:482-490` and the README assume
   ordered deadlines; the contract does not enforce that order (D31), and `AfterCppReclaim.t.sol:91-104` tests it. An
   expiry in Held before `deliverBy` blocks every capture; `late_judge_by` covers only `judgeBy`. R4 adds a Held
   branch or names the case under "Not modelled".
