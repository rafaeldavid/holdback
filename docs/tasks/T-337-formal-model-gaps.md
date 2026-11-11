# T-337: The formal model's gaps

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-204 (the model), T-206 (the contract review, §5 and I-11)
- **Paths this task may touch:** `formal/`, this task file, and row G-3 of `docs/audit/known-issues.md`
- **Human gate:** no
- **Status:** in progress
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

- [ ] The model has the CPP expiry, the buyer's CPP reclaim, and the rules contract's behaviour after it.
- [ ] The model has free and encumbered bond per adjudicator, with the coverage gate, release and slash.
- [ ] New safety properties hold in `safety.cfg`; each has a `broken/` config that shows it bites.
- [ ] L-6 is encoded as a documented `broken/` config, not as fixed.
- [ ] The README's contract column names the function, storage field and line for every action and variable.
- [ ] `formal/check.sh safety`, `formal/check.sh broken/` and the full run pass.
- [ ] G-3 reads fixed in this PR.

## Out of scope

- Signatures, scopes and mandates; the Phase 4 economics; L-3 and L-5 (a minimum appeal bond, an appeal
  adjudicator's own bond).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
