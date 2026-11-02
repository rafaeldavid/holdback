# T-203: Invariant and fuzz tests for the rules contract

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-202's external interface (function signatures and events merged; handlers can be written against it while T-202 finishes its internals). The full campaign runs against T-202 as merged.
- **Paths this task may touch:** `contracts/test/invariant/`, `contracts/test/fuzz/`, `contracts/test/handlers/`, `.github/workflows/ci.yml` (add a `contracts` job running `forge test`, and a `formal` job that runs `formal/check.sh` only when that file exists, so T-204 needs no CI edit; change nothing else in the file), `docs/team.md` (the "No admin keys" row of Rules and checks only), `docs/tasks/T-203-contract-invariants.md`
- **Human gate:** none. Local chain only; no public network.
- **Status:** todo
- **Agent/session:** —

## Intent

Prove, by stateful fuzzing against the Foundry contracts, the invariants SimChain already property-tests: no unit of token is created or destroyed, no escrow settles twice, nothing has an admin path. Handlers drive random interleavings of every submission and every timeout from random callers, so a guard that only holds on the happy path fails here. Run in CI.

**In my words (T-203 agent, 2026-11-01).** T-202's unit tests show each guard on the path its author had in mind. This task asks whether the guards still hold when nobody is choosing the path: a handler calls every entry point of `HoldbackRules` and `HoldbackBonds` and every timeout, in random order, from random actors (parties, the three adjudicators, an operator, a stranger), with signatures from random keys, while time jumps onto, just before and just after every deadline. After every call, Foundry checks that tokens are conserved per token, CPP's token store holds exactly what the open commitments say, no commitment settles twice, bond books never go negative or double-count an encumbrance, every timeout fires exactly when due (for anyone), nothing moves without the right signature or a due timeout, and no admin path exists. Each invariant must be shown to catch a deliberate bug (a mutant in a scratch copy). CI runs `forge test` and the formal model's check, and the required `check` job waits for both.

**Non-goals.** No contract change: HoldbackRules has 34 bytes of EIP-170 headroom, and a failing invariant is a T-202 finding, recorded in Handoff. Not the formal model (T-204), not SimChain differential tests (T-205, running in parallel in `packages/settlement/evm`), not external review (T-206). Local EVM only: no broadcasts, no `cast send`, no public RPC.

## Context

- `docs/architecture.md` (invariants list, postings table); ADR-0022 (rounding: requirements up, splits round the rate side down with a named remainder claimant, bond payouts down); ADR-0003 (settle-once and idempotency live in the rules contract).
- `packages/settlement/sim/properties.test.ts` (the SimChain properties to mirror); `docs/neutrality.md` (contract review checklist: no owner, pause, blacklist, `selfdestruct`, upgrade proxy; every timeout callable by anyone).
- `docs/team.md` Rules and checks, "No admin keys" (Phase 2 check owed) and "Every settlement guard is tested on its own" (mutation sweep).

## Acceptance criteria

- [ ] Handlers cover every external function and every `TimeoutKind`, with callers drawn from the parties, the three adjudicators, an operator and an unrelated address, and time warps across every deadline.
- [ ] Invariants, each its own `invariant_*` function: conservation (sum of token balances over all actors, the escrow and the bond escrow is constant); the escrow's balance equals the sum of open holds; each commitment settles at most once; no balance underflows; encumbered bond is never counted twice; a timeout never succeeds before its deadline and always succeeds after it for any caller when its state allows.
- [ ] Fuzz tests for rounding: for random amounts and bps, share plus remainder equals the pot, requirements round up, bond payouts round down (ADR-0022).
- [ ] No admin selectors: an ABI-level test over every deployed contract fails on any selector outside a reviewed allowlist, and on any of the checklist's forbidden functions or opcodes.
- [ ] `forge test --match-path 'test/invariant/*'` green with at least 256 runs and depth 100 (set by inline `forge-config`, so `foundry.toml` stays T-202's), and the run count and seed recorded in Evidence (measured).
- [ ] Each invariant is shown to bite: for each one, a named mutant of the contract (applied in a scratch copy, journaled and restored as `docs/team.md` requires) makes it fail. List mutant and failing invariant in Evidence.
- [ ] CI runs `forge test` in a `contracts` job and `formal/check.sh` in a `formal` job when present; the `check` job requires both. `docs/team.md` "No admin keys" row points to the test.
- [ ] `pnpm verify` still green. PR opened.

## Out of scope

- Changing contract code: a failing invariant is a finding for T-202 (write it in Handoff and stop).
- The formal model (T-204), differential tests against SimChain (T-205), external review (T-206).

## Evidence

## Decisions

## Handoff
