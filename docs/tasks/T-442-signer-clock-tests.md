# T-442: the signer's date tests read one clock

- **Lane:** demo (Crow's own agents, build row 3)
- **Phase:** 2
- **Depends on:** T-439 (the signer, PR 555)
- **Paths this task may touch:** `examples/signer.test.ts`, this file. It also closes code scanning alert 32 (`js/unnecessary-use-of-cat`, `examples/signer.test.ts`), at the coordinator's request
- **Human gate:** no
- **Status:** review
- **Agent/session:** own-agents build session, on the coordinator's report of 2026-11-14 (`main` red on `test (1/4)`)
- **Roadmap row:** N131

## Intent

`main` failed on `examples/signer.test.ts`, "A7: changed terms (B6, B8)": a request the test expected the signer to refuse was signed. First question: did the signer sign something its rules refuse? Second: if not, make the test read the same clock as the signer, and assert both sides of every date bound exactly, with no sleep and no wider tolerance.

## What it was: the test, not the signer

From CI run 43616229331 (`main` at `e2b044aa`, job `test (1/4)`, 2026-11-14 16:43 UTC). Measured in the log: the signer answered 200, with the offer expiring at 16:45:45Z and the funding valid until 16:50:45Z (`fundBy`). Inferred from those: the test left `fundBy` at `termsFor`'s default, `createdAt` + 600 s, so `createdAt` was 16:40:45Z and the offer window exactly 300 s. Rule B8 allows at most 300 s (`offerExpiresInSec`), so the signer was right to sign.

The test meant to send a window of 301 s. It took `now` once (16:40:44.9xx, inferred from the values), set `offerExpiresAt` to that second plus 301 s (16:45:45Z), and let `termsFor` read the clock again for `createdAt`. On the CI machine that second read fell in the next second (16:40:45Z), so the window it sent was 300 s. The same pattern sat in the 601 s funding case.

The signer itself has no gap there (measured by reading `examples/signer.ts`): it reads its clock once per decision; every date must be a whole second in UTC; each window refuses only above its limit (`v - from > most * 1000`); a `createdAt` more than `clockSkewSec` ahead refuses; and an offer refuses from the second it expires (`now >= offerExpiresAt`). No red-team pass is needed: no real request can pass a bound it should not.

## Acceptance criteria

- [x] A7 builds every date it sends from one second, so no case depends on when the test reads the clock.
- [x] A test with the signer's clock injected (`OpenOptions.now`) asserts both sides of every B8 bound: the offer window (300 s signed, 301 s refused), the funding window (600 s, 601 s), the delivery window (3,600 s, 3,601 s), each judging window (3,600 s, 3,601 s), the order of the offer and the funding (equal signed, the offer 1 s later refused), the clock ahead (60 s signed, 61 s refused), and the offer's expiry by the signer's clock (1 ms before signed, at it refused).
- [x] `examples/signer.test.ts` passes, and no other file changes.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-T-441`, branch `t-442-signer-clock-tests`, from `main` at `6d8aaff7`.

- `npx vitest run examples/signer.test.ts`: 39 passed (31 before, and 8 new boundary tests).
- The boundary tests fail when a comparison moves by one step. Each mutation of `examples/signer.ts` was undone after its run:

  | Mutation | Boundary tests that failed (of 8) |
  | --- | --- |
  | a window refuses at its limit (`>=` for `>`) | 8 |
  | a window allows 1 s more than its limit | 5 |
  | `createdAt` refuses at exactly 60 s ahead | 1 |
  | the offer refuses only after its expiry (`>` for `>=`) | 1 |

- `pnpm typecheck`: 0 errors. `npx eslint examples/signer.test.ts`: 0 problems.

### Review (PR 568)

The `reviewer` agent found the signer right and the test wrong, no boundary a real request could pass, and no other test in the file exposed to the same race. It ran 18 one-step mutations of the B8 comparisons; each failed at least one boundary test. Verdict: ISSUES, four low findings, all fixed: one signer for the whole boundary block (sixteen in-process signers had passed Node's limit of 10 exit listeners); `at()` lost a parameter it did not use; a comment named a parameter that does not exist; this file labels the inferred `createdAt` and puts units on every number.

For triage, not this task: the signer's `TIME` pattern with `Date.parse` takes dates that do not exist (`2026-02-30T00:00:00Z` reads as 2 March, `T24:00:00Z` as the next midnight). The signer and `verify.ts` read them the same way, so the bound it checks is the one it signs (inferred); whether the operators and the chain read them so too is not known.

## Handoff

Code scanning alert 32 (`js/unnecessary-use-of-cat`): the A13 test now asks Node whether the flag file is readable, in place of running `cat` on it.


Done. The failure was a test that read the clock twice; the signer's bounds hold exactly where the rules put them. The other tests that build terms from the wall clock take every deadline from the terms' own `createdAt` (`termsFor` in `signer-test-kit.ts`), so a second read of the clock cannot change a window. Against the signer's clock such a `createdAt` sits up to a few seconds behind it, well inside the 60 s allowed ahead and the 300 s before the offer expires (inferred from the code).
