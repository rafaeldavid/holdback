# T-322: The T-206 defense tests become regression tests

- **Lane:** contracts (tests only)
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `contracts/test/unit/Withstood.t.sol`, this file.
- **Human gate:** none. No contract code changes and no deploy.
- **Status:** done (see Handoff)
- **Agent/session:** Withstood port session, 2026-11-11 (Rafa: "Yes, start it")
- **Kind:** 7, smart contracts (test-only): `forge test`, one review, 300k-token budget.

## Intent

The T-206 red team (2026-11-03) wrote seven defense tests that were never committed. Main has regressions for every attack file but nothing like these seven. This task ports them into `contracts/test/unit/Withstood.t.sol` so the defenses stay pinned:

- reentrancy through an ERC-777-style hook token;
- cross-deployment replay;
- a funding-method swap;
- a zero-address payout and a zero-address role;
- one address in two roles with no cross-role replay;
- an Info test: a co-signed payout to the rules contract strands the tokens.

## Acceptance criteria

- [x] The file is in `contracts/test/unit/` and imports `./Base.sol`.
- [x] The netted-reservation assertion expects `PRICE`, because main nets one address's primary and fallback reservations into one (`BondConsent.t.sol`).
- [x] The stranded-tokens test is named `test_info_…`: it records behaviour the parties own (D31, D32), and the contract stays as it is.
- [x] `forge test` passes for the file and for the whole suite.

## Out of scope

Any change to contract code; the other red-team files, which main already covers.

## Evidence

- Measured, 2026-11-11: `forge test --match-path test/unit/Withstood.t.sol` passes 7 of 7.
- Measured, 2026-11-11: `forge test --root contracts` passes 248 of 248 tests in 37 suites.

## Handoff

- Done: the seven tests are on main once the PR merges.
- To resume: `forge test --root <checkout>/contracts --match-path test/unit/Withstood.t.sol`.
