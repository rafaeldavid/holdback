# T-409: operator hardening before the partner's first deal

- **Lane:** first pilot
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests with anvil, one review and one red team, a target of 250k tokens. The demo world's test is kind 4.
- **Depends on:** T-347 (PR 346) and T-372 (PR 389), both merged and live
- **Roadmap:** N80 ("A delivery with no stored ciphertext can't stall the adjudicator for other deals") and N92 ("The read-after-write attacks run against the phase-one adapter"), both marked "before design partner A's first deal"
- **Paths this task may touch:** `apps/demo-cloud/` and its tests; the operator's relay and read paths in `packages/settlement/evm/` (`live.ts`, `sync.ts`, `timeouts.ts`, `errors.ts`, `chain.ts`, the read model in `evm-settlement.ts`) and their tests; `tests/read-after-write*.test.ts`; the read-after-write rule in `eslint.config.js`; this file. Never: `contracts/src/`, `spec/schemas/`, `examples/seller-adapter*.ts`.
- **Human gate:** no for the code. The operators change only with a deploy, which waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-409 session, 2026-11-14, branch `t-409-operator-hardening`, worktree `.worktrees/holdback-T-409`

## Intent

**N80 is mostly built already.** The roadmap row's `starts` field still lists four open items, but T-372 (PR 389, merged 2026-11-12 at 07:21 UTC, live from the operator deploy of 07:22 UTC) built all four: a time limit on every store read the adjudicator's pass awaits, the demo world's refusal on the state read, the cleared decline, and the relay's check of its own store. Its tests pass on today's `main` [measured below]. What T-372 did not show is the hung deal itself reaching its outcome on the phase-one contract: its tests run on the in-memory settlement and stop at "the deal stays Delivered, retried". This task adds that proof on anvil: a store that never answers for one deal's ciphertext, the other deal judged, and the hung deal closed by the default outcome at fallbackBy, with the operators' own timeout pass sending it.

**N92 is the real work.** T-232's review round (four commits on the archived branch `archive/t-232-review-round-backup`, `3515172` to `f576398`) never reached `main`. Its red team found that the operator's chain relay can be made to read stale state or reuse a nonce: one wrong head from an RPC node raises the read floor past the chain, an answer to a mined relay is lost when a balance read fails, a lane's remembered nonce stays too high after a reorg, a node's "no such block" answer in some shapes is taken as a revert, a stale book reaches a stranger's direct takeover, and the lint rule that keeps chain reads pinned has bypasses. This task ports those tests to the phase-one adapter, adds the fixes they need, and says which no longer apply.

## Acceptance criteria

- [ ] T-372's tests for the four N80 items pass on `origin/main` (measured, named).
- [ ] An anvil test in the demo world: one deal's ciphertext read never returns; another deal in the same world is judged and Released; the hung deal ends by the default outcome (Refunded to the buyer's payment address) by fallbackBy plus the operators' timeout pass, and the world logs the refusal. It runs in CI's anvil job.
- [ ] The relay check (item 2) is described against the three litmus tests (Decisions).
- [ ] Each of the archived branch's red-team tests either runs in CI against the phase-one adapter and passes, or is listed below as not applying, with the reason.
- [ ] Each test that needs a fix fails on `main` before it (measured) and passes after.
- [ ] The packages' tests (`packages/settlement`, `apps/demo-cloud`, `tests/read-after-write*`) with anvil, `pnpm typecheck` and `pnpm lint` pass.
- [ ] One reviewer pass and one red-team pass that tries to make a deal settle wrongly or stall through the store and the relay; Critical and High findings fixed.

## Evidence

(filled in as the work runs)

## Decisions

(filled in as the work runs)

## Handoff

(filled in at the end)
