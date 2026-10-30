# ADR-0009: Testing strategy

- **Status:** Accepted, 2026-10-30.
- **Date:** 2026-10-30

## Decision

The test layers, in order of reliance:
1. Types that make illegal states unrepresentable.
2. Table-driven unit tests.
3. Property tests for ledger invariants.
4. Scenario expect tests over a deterministic simulation, with golden `.expect.md` files and the filename prefixes `error.`, `attack.`, `neutrality.` and `todo.`.
5. Differential tests between SimChain and the contract.
6. Foundry invariant tests.
7. A formal model of the state machine.

Calibration and red-team runs measure model quality outside CI. Details are in `docs/testing.md`.

## Sources

- Ron Minsky (Jane Street), "Now more than ever: building reliable software in the age of agents," Bug Bash 2026, May 14, 2026: types, expect tests, deterministic simulation, example-based tests, code review, formal verification.
- React Compiler fixture suite (input plus `.expect.md`, `error.` prefixes, pragmas): the format only.
- Lauren Tan's pstack: verification before parallelism; claims labeled measured, inferred or guessed; TLA+ for workflow verification.
