# T-372: a hung store read never stalls the adjudicator

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests, one red team before it lands, a target of 200k tokens.
- **Depends on:** T-347 (an unreadable delivery never stalls other deals)
- **Roadmap:** "A delivery with no stored ciphertext can't stall the adjudicator for other deals", reopened
- **Paths this task may touch:** `apps/adjudicator/src/`; in `apps/demo-cloud/src/world.ts` only the declined-offer and refusal bookkeeping (the `DeclinedTurn` block, the state read's notices, `look()`'s skip of a declined offer, and the pass in `work()`), and its tests; the operator's delivery relay in `apps/operator/src/server.ts` and its tests; the fixtures this task adds; `docs/neutrality.md` for the fixtures' lines; this file.
- **Human gate:** no. The fix reaches the live adjudicators and operators only with a deploy, which waits for Rafa.
- **Status:** done (PR 389, merged 2026-11-12 at 07:21 UTC as `ec498d9`; live from the operator deploy of 07:22 UTC)
- **Agent/session:** the T-372 session, 2026-11-12, branch `t-372-hung-read-timeout`

## Intent

**Problem.** T-347 made a store read that *fails* cost only its own deal. A read that *never returns* still stalls everything: the adjudicator's pass awaits it, `runOnce` never returns, and every later deal in that pass and in all later passes goes unjudged. Three related gaps make the same failure hard to see or start:
1. The demo world's state read keeps only refusals on the terms, so a deal refused because the store did not answer shows no reason at all.
2. The demo world never clears a declined offer, so an offer the primary declined once (a reference not yet uploaded) still reads "declined, nobody can fund it" after the primary accepted it.
3. No operator checks its store before it relays a delivery, so a seller learns that its ciphertext is missing only when the deal defaults.

**Goal.**
1. Every read the pass awaits from the settlement port and its store has a time limit: the delivery's ciphertext, reference files, registrations, policies, bond cover and the task lists. A read past the limit is treated as an unreadable delivery is today: that deal is refused with the reason, nothing is judged, signed or published, the pass goes on with the other deals, and the deal is tried again on a later pass. A timeout never decides a deal and never reports it as declined.
2. The limit is a setting of the adjudicator service (`storeReadTimeoutMs`) with a stated default, not a protocol rule. Writes (a submission, a record publication) keep no limit here: their outcome after a timeout is unknown, and each relay has its own transport timeout.
3. The demo world's state read and its log carry an adjudicator-unavailable refusal, cut short and with no store error text.
4. A decline the primary reverses (it accepts on a later pass) leaves the public state read.
5. An operator with a ciphertext store refuses to relay a delivery whose ciphertext that store does not hold, and the error tells the seller to upload it first. The refusal is this operator's alone: other operators and direct submission still take the same signed delivery.

**Inputs.** The adjudicator's settlement port and store; the operator's store and the seller-signed Delivery.

**Outputs.** The timeout in `apps/adjudicator/src/service.ts`; the bookkeeping in `apps/demo-cloud/src/world.ts`; the relay check in `apps/operator/src/server.ts`; a failing test for each of the four gaps, committed before its fix; a `neutrality.*` test for the hung read and one for the relay check.

**Non-goals.**
- No change to the contracts, core, the settlement packages or the schemas.
- No signed reject for a ciphertext the store does not return in time (T-347 Decision 1 applies).
- No timeout on writes, the judges (they have their own) or the drand relays (they have their own).

## Context

- `docs/tasks/T-347-unreadable-delivery.md`: Decisions 1 and 2, and the red team's L1.
- `apps/adjudicator/src/service.ts` (`runOnce`, `#judge`, `#referenceProblem`), `settlement-port.ts`.
- `apps/demo-cloud/src/world.ts`: `DeclinedTurn`, the state read's `notices`, `look()`, `work()`.
- `apps/operator/src/server.ts`: `write()` and the relay policy (ADR-0005, D27).
- `docs/neutrality.md`.

## Acceptance criteria

- [ ] A test for each gap fails on `origin/main` and passes after the fix: the hung read, the missing refusal on the state read, the decline that is not cleared, the relay that does not check the store.
- [ ] A store that never answers for one deal: the two other deals in the same pass are judged (`neutrality.store-hangs`).
- [ ] An operator whose store lacks the bytes refuses; the SDK fails over to an operator that holds them and the deal settles (`neutrality.operator-lacks-ciphertext`).
- [ ] The timeout's default, its unit and why are in the adjudicator's configuration docs.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm snap` pass; no existing `neutrality.*` or `attack.*` fixture changes its outcome.
- [ ] One red team on the diff; Critical, High and Medium findings fixed, Lows listed.

## Out of scope

- A write that never returns (a submission, a publication): each relay has its own transport timeout.
- An operator that checks a ciphertext held in another store than its own.

## Evidence

All runs on 2026-11-12, on branch `t-372-hung-read-timeout`, from `origin/main` at `697218c`.

- **Before the fix (measured).** The four gaps' tests were committed alone, as `5028ece`, and failed on `697218c`:
  1. **Hung read** (`apps/adjudicator/src/hung-read.test.ts`): 11 of 11 failed. Each pass hung until the test's 2 s guard: "the pass did not return within 2000 ms: a store read stalled it".
  2. **Refusal not shown** (`apps/demo-cloud/src/refusals.test.ts`): the state read's notices were empty for a delivered deal whose ciphertext the store did not return.
  3. **Decline not cleared** (same file): after the reference was uploaded and the primary accepted, the state read still said "The primary adjudicator declined this offer".
  4. **Relay unchecked** (`apps/operator/src/relay-store.test.ts`): 4 of 6 failed. An operator whose store lacked the bytes relayed the delivery; the 2 that passed cover behaviour that does not change.
- **After the fix (measured).** All four files pass: 13, 2 and 9 tests. `pnpm typecheck` and `pnpm lint` exit 0. `pnpm test`: 158 files passed and 12 skipped; 3,207 tests passed and 171 skipped. `pnpm snap`: 39 passed, 0 failed, and no `.expect.md` changed, so no `neutrality.*` or `attack.*` fixture changed its outcome.
- **The new neutrality tests (measured).** `neutrality.store-hangs`: one deal's store read never answers, and the two other deals in the same pass are judged and Released. `neutrality.operator-lacks-ciphertext`: op-1's store lacks the bytes and refuses, the SDK fails over to op-2, which holds them, and the deal settles Released; with no operator holding them, the SDK submits directly and the deal is Delivered.
- **Read times (measured).** `node reports/scratch/t-372-read-times.mjs`, 20 reads each: the filesystem store reads 1 MiB in a median of 0.9 ms (max 1.3 ms) and 10 MiB in 6.6 ms (max 8.7 ms); the memory store 0.5 ms and 4.9 ms (max 5.8 ms). No live store was read (no live run in this task).
- **Red team (measured).** One `red-teamer` pass on `4e46a50` found no Critical or High findings: 2 Medium and 6 Low. Its 7 proof tests reproduced each finding. Its full report is `reports/scratch/t-372-redteam.md` in this worktree.
  - **Fixed, each with a test:**
    - M1: a pass was bounded only for joined reads, and stuck offers ran before the tasks. Now registrations are joined too, a pass waits out at most 2 limits, and the offers come last (Decisions 3 to 5).
    - M2: the notice quoted the URI the seller signed, so a seller could put instructions into the adjudicator's notice. Now the world names it instead, and a timeout names only a hash (Decision 8).
    - L1: a key that had relayed a delivery got a 403 on replay after the store lost the bytes. Now the check runs inside the idempotent handler.
    - L2: the relay check read only the signed hash. Now it checks the hash the URI ends in too.
    - L4: a delivery already on the chain met the check when joined to the book. Now one past Held is not checked.
    - L5: the 400-character cut dropped the deadline. Now the cut is at 600 characters.
    - L6, three parts: a list timeout no longer clears notices; each list timeout is logged once; a refusal supersedes an earlier decline.
  - **Left (Low):**
    - L3: a `publishRecord` (a write) that never returns still stalls the pass. Writes are out of scope (Decision 1).
    - L6, two parts: timed-out reads are not cancelled, since the port takes no AbortSignal. `#inflight` is pruned at each pass and `#stalled` to the deals seen, so neither grows without bound.
    - The pass bound still grows with the number of stuck reads, at 1 s each after the first 20 s. Only a store that hangs for chosen URIs can cause that, and no adapter here fetches seller URIs (guessed for adapters outside the repository).
  - **What held:**
    - No timeout decides, declines, signs or publishes.
    - No panel is re-rolled.
    - A late answer is checked against its hash before use.
    - No store error text reaches a notice.
    - The operator refusal leaves no shared state.
- **Not run locally.** `pnpm verify`, the anvil and fork tests, `forge test` and gitleaks. CI runs them.

## Decisions

1. **The limit wraps the port, not each call site.** The service builds a wrapper over `settlement` in its constructor, so every read the pass awaits has the limit, including reads added later: the task lists, the bond cover, registrations, policies, the delivery's ciphertext and the reference files. Writes (`submit`, `publishRecord`, `triggerFallback`, `expireAppeal`) pass through unchanged: on Sepolia a submission waits about a minute for its block, and a write that timed out may still land, so a retry could send a second transaction. The drand relays and the judges keep their own timeouts.
2. **A timeout is a refusal, never a decline or a decision.** A ciphertext or reference read past the limit is refused as an unreadable delivery is (T-347 Decision 1): no judge is called, nothing is published or signed, and the deal is retried. At acceptance a timed-out reference read throws instead of declining, so the offer is reported as refused and the demo world never publishes it as declined.
3. **A read in flight is joined, not asked again, where the same key gives the same answer.** The delivery's ciphertext and a reference (by URI), a policy (by hash) and a registration (by address; every deal of a pass asks for the same few, red team M1). A later pass joins a read still in flight. Past its limit it is refused at once, so a stuck store costs one full wait per read, not one per deal per pass, and an answer that arrives late is taken by the next pass. A read in flight for `STORE_READ_RETIRE_LIMITS` (30) limits, 5 min at the default, is dropped and asked again, for a store that lost the request. The retire age is counted in limits, not passes: a pass with many stuck deals is itself several limits long, and the first try's retire age of 6 limits re-asked every stuck read on the next pass (measured: each stuck URI read twice in two passes).
4. **A pass is bounded.** It waits out at most `PASS_WAIT_LIMITS` (2) limits on reads that time out, 20 s at the default; after that each further read in the pass waits a tenth of the limit, at most 1 s (red team M1). A read cut short that way does not mark its deal stalled, so it goes first next pass with the full limit.
5. **Order.** A deal whose last unit used its full limit goes after the others on the next pass. The pass now runs the appeal expiries, the takeovers, the tasks and then the offers: the turns with a deadline before the offers, so new offers with stuck reads cannot delay a delivered deal (red team M1). Taking the tasks before the offers also leaves more free bond for a fallback's cover check.
6. **The default is 10 s.** A local read of the largest ciphertext a store keeps (10 MiB) takes a median of 6.6 ms and at most 8.7 ms (measured, 20 reads, `reports/scratch/t-372-read-times.mjs`); a remote read of 10 MiB at 10 Mbit/s takes about 8.4 s (inferred). With the pass bound, a pass waits out at most 20 s, inside the demo's shortest window of 60 s (`minWindowSec`). It is the adjudicator service's own setting (`storeReadTimeoutMs`, documented in `AdjudicatorConfig`), not a protocol rule: any positive number, and Infinity means no limit (D31).
7. **The relay check refuses only on a definite "not held", at this operator only.** The operator reads its own store by the delivery's signed `ciphertext.sha256`, and by the hash the URI ends in when it names one, since the demo adjudicator reads by that (red team L2). `not_found` refuses with `relay_refused` (403) and the next step; a store that fails or does not answer within 2 s lets the relay go on. A delivery already past Held on the settlement layer (sent there directly and now joined to the book) is not checked (L4). The check runs inside the idempotent handler, so a key that already relayed replays its answer (L1), and a refusal is not stored, so the same key works once the bytes are up. It cannot block a valid delivery elsewhere: nothing reaches the settlement layer, the SDK fails over to the next operator on any refusal, and direct submission does not pass through it (`neutrality.operator-lacks-ciphertext`). Stores have no delete, so no third party can make an operator lack bytes it holds.
8. **The demo world shows only `adjudicator_unavailable` refusals, in the service's own words.** Since this task no refusal carries a store or relay error message, only the error's class (the record publication and the appeal expiry did before), and a timeout names a hash, never a URI. The world replaces the URI the seller signed with "(the URI the seller signed)" (red team M2: a seller could put instructions in it), cuts the detail to 600 characters, shows it only while the deal stays in the state the refusal met, drops it when a pass no longer refuses (but not after a pass whose list did not answer), and logs each new or changed reason once through `onError`. A refusal supersedes an earlier decline of the same offer.

## Handoff

**Done.**
- No store read can stall the adjudicator's pass: each has a limit (`storeReadTimeoutMs`, default 10 s), and a pass waits out at most 20 s in all.
- A deal whose read times out is refused, never decided or declined, and retried.
- The demo's state read and log say why a deal is not judged, without the store's error or the seller's URI.
- A reversed decline is cleared.
- An operator refuses to relay a delivery whose bytes its own store lacks; other operators and direct submission are not affected.

**What an operator deploy changes.** The demo adjudicators run inside the operator Worker, so one deploy of both operators carries all of it:
- A delivery POSTed without its ciphertext uploaded first is now answered 403 `relay_refused`, naming the hash and `POST /v1/ciphertext`. The demo seller and `examples/agent.ts` upload first, so they are not affected (inferred from the code; `apps/demo-cloud` tests pass).
- A deal the adjudicators cannot judge yet now reads "The primary adjudicator cannot judge this deal yet: …" on its state read, and the Worker log gets one `demo world:` line per new reason.
- No new variable, secret or contract change.

**The deploy is Rafa's.** After it, run this smoke check:
1. `pnpm demo-cloud:deploy`, whose `examples/try.ts` deal must end Released within 180 s.
2. A delivery POSTed to `/v1/commitments/{id}/deliveries` with a ciphertext hash never uploaded must answer 403 `relay_refused` naming that hash.

**How to resume.** Run `pnpm build`, then `pnpm exec vitest run apps/adjudicator/src/hung-read.test.ts apps/operator/src/relay-store.test.ts apps/demo-cloud/src/refusals.test.ts`.
