# T-442: the signer's date tests read one clock

- **Lane:** demo (Crow's own agents, build row 3)
- **Phase:** 2
- **Depends on:** T-439 (the signer, PR 555)
- **Paths this task may touch:** `examples/signer.test.ts`, this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** own-agents build session, on the coordinator's report of 2026-11-14 (`main` red on `test (1/4)`)
- **Roadmap row:** N131

## Intent

`main` failed on `examples/signer.test.ts`, "A7: changed terms (B6, B8)": a request the test expected the signer to refuse was signed. First question: did the signer sign something its rules refuse? Second: if not, make the test read the same clock as the signer, and assert both sides of every date bound exactly, with no sleep and no wider tolerance.

## What it was: the test, not the signer

Measured from CI run 43616229331 (`main` at `e2b044aa`, job `test (1/4)`, 2026-11-14 16:43 UTC). The signer answered 200 for terms with `createdAt` 2026-11-14T16:40:45Z and `offerExpiresAt` 16:45:45Z (`fundBy` 16:50:45Z): an offer window of exactly 300 s. Rule B8 allows at most 300 s (`offerExpiresInSec`), so the signer was right to sign.

The test meant to send a window of 301 s. It took `now` once (16:40:44.9xx, inferred from the values), set `offerExpiresAt` to that second plus 301 s (16:45:45Z), and let `termsFor` read the clock again for `createdAt`. On the CI machine that second read fell in the next second (16:40:45Z), so the window it sent was 300 s. The same pattern sat in the 601 s funding case.

The signer itself has no gap there (measured by reading `examples/signer.ts`): it reads its clock once per decision; every date must be a whole second in UTC; each window refuses only above its limit (`v - from > most * 1000`); a `createdAt` more than `clockSkewSec` ahead refuses; and an offer refuses from the second it expires (`now >= offerExpiresAt`). No red-team pass is needed: no real request can pass a bound it should not.

## Acceptance criteria

- [x] A7 builds every date it sends from one second, so no case depends on when the test reads the clock.
- [x] A test with the signer's clock injected (`OpenOptions.now`) asserts both sides of every B8 bound: the offer window (300 s signed, 301 s refused), the funding window (600, 601), the delivery window (3,600, 3,601), each judging window (3,600, 3,601), the order of the offer and the funding (equal signed, later refused), the clock ahead (60 s signed, 61 s refused), and the offer's expiry by the signer's clock (1 ms before signed, at it refused).
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

## Handoff

Done. The failure was a test that read the clock twice; the signer's bounds hold exactly where the rules put them. The rest of the signer's tests that build dates from the wall clock (the control cases in A3 to A14) depend on no bound to the second: they sit at least 60 s inside every window (inferred from the values in `signer-test-kit.ts`).
