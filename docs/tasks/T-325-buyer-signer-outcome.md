# T-325: the buyer signer reports the outcome and reclaims a hold after a missed deadline

- **Lane:** examples (client code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the examples' tests, no review, a target of 150k tokens. The `site/llms.txt` edit is kind 1.
- **Depends on:** T-319 (`examples/buyer-signer.ts`).
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buyer-signer-outcome.test.ts` (new), `examples/buy-with-signer.ts`, `vitest.config.ts` (one cost line for the new test file), `site/llms.txt` (the buyer signer's section only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/seller-adapter.ts` and its stub, template and test (T-323, T-324), `examples/audit-deal.ts` (T-326), `examples/agent.ts`, `examples/verify.ts`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` edit waits for Rafa.
- **Status:** done (PR 307, merged 2026-11-11)
- **Agent/session:** the T-325 session, 2026-11-11, branch `t-325-buyer-signer-outcome`
- **Roadmap row:** N62

## Intent

Rafa listed this gap on 2026-11-11, after the first audit deal: the buyer signer stops at the funding.

**Problem.** `examples/buyer-signer.ts` (T-319) funds a deal and then only waits, for 10 minutes, for `Released` or `Refunded`. The buyer's agent learns nothing on the way. When the seller never delivers, the hold stays until someone sends the reclaim after `deliverBy`; on SimChain nobody does, and on Sepolia the buyer waits for the operators' own pass. A signer that is restarted between the funding and the outcome has to be told the commitment ID again.

**Goal.** After the funding, the signer follows the deal to its outcome, on the buyer's machine:
- it tells the buyer's agent, through a callback, when the deal is released, when it is refunded, and when `deliverBy` passes with nothing delivered;
- once `deliverBy` passes with the deal still `Held`, it sends the reclaim itself and reports the refund;
- it reads the state from every configured operator and goes on when one of them is offline;
- it keeps what it has done in the key file, so a restart neither loses the deal nor sends the reclaim twice.

**Inputs.** A signer that `agreeAndFund` funded (or `loadKeys` reopened), the agreed terms it saved, and the configured operators.

**Outputs.**
1. `BuyerSigner.watch(commitmentId, { onReport })`: follows the deal to `Released` or `Refunded`, sends the reclaim when it is due, and returns the outcome. `openDelivery` calls it, so a client that only calls `openDelivery` gets the reclaim too.
2. `openDeals(store)`: the funded deals in a key store with no recorded outcome, for a client that restarts without the commitment IDs.
3. Tests on SimChain through `startSimWorld`: the missed deadline, the deadline with one operator offline, a restart at each step around the reclaim, and the released and refunded reports.
4. The buyer signer's section in `site/llms.txt` says what the signer reports and that it sends the reclaim.

**Non-goals.**
- No new route, schema, contract or signed message.
- No Python signer and no Delegation admission (roadmap row N38).
- No buyer appeal, no early accept and no mutual settlement in the signer.
- No limit of the signer's own on any deadline (D31): it reads `deliverBy` from the agreed terms, and waits as long as the terms say.

## Context

- `site/llms.txt`, "Beyond the happy path": the operators send each timeout a minute or two after its deadline; anyone may send `POST /v1/commitments/<id>/triggers/reclaim` with `{}` once `deliverBy` has passed; too early is 409 `invalid_state`.
- `spec/openapi/paths.json`, the triggers route: "Anyone may call a trigger once its deadline passed; no signature."
- `apps/operator/src/idempotency.ts`: an operator stores only answers below status 300 under their `Idempotency-Key`, so a 2xx replays and a refused trigger can be sent again under the same key. (Corrected in the review fixes: this line first said refusals replay.)
- `examples/agent.ts` (`Agent.trusted`, `Agent.sources`), `examples/audit-deal.ts` (its own reclaim through the trigger route).
- Hard rules in `CLAUDE.md`: signed messages, idempotency, secrets never printed; neutrality (an offline operator does not stop the deal).

## Acceptance criteria

- [x] `watch` reports `released`, `refunded` and `deliverBy-passed` to the buyer's agent, each once per run, and returns the outcome.
- [x] After `deliverBy` passes with the deal `Held`, `watch` sends the reclaim with an `Idempotency-Key`, and reports the refund; the buyer's balance shows the hold back.
- [x] The missed-deadline case passes on SimChain through `startSimWorld`, and again with one of the two operators closed.
- [x] A signer reopened from the key store after a stop before the reclaim, after a reclaim whose answer was lost, and after the reclaim landed reaches `Refunded` with one reclaim request in all.
- [x] `openDeals(store)` lists a funded deal with no outcome after a restart, and not once the outcome is recorded.
- [x] Tests cover the released and the refunded (by decision) reports.
- [x] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A Python signer; Delegation admission (N38).
- A sweep of a refunded hold off the per-deal key (T-319 Handoff 1).
- Outcomes other than `Released` and `Refunded` as final states (an appeal, a settlement, a default in progress): `watch` keeps waiting through them.

## Evidence

All measured on 2026-11-11 on branch `t-325-buyer-signer-outcome`, in a worktree of `origin/main` at `a310279`, unless a line says otherwise.

- `pnpm exec vitest run examples/buyer-signer-outcome.test.ts`: 5 tests pass in 5.3 s, on SimChain through `startSimWorld` (two operators, no timeout pass of its own, the clock moved with `world.advance`). A wrapper around `fetch` counts the reclaim requests.
  1. Missed deadline: the signer watches a `Held` deal and reports nothing; after the clock passes `deliverBy` it reports `deliverBy-passed` (with the terms' `deliverBy`), sends 1 reclaim request with an `Idempotency-Key`, and reports `refunded` with `reclaimed: true`. Both operators show `Refunded` and 1 `settlement.reclaimed` event; the buyer's balance is back at 10,000 tUSD (the price and the 1 tUSD adjudication fee). `openDeals` is empty; a second `watch` returns the same outcome, reports nothing and sends nothing.
  2. One operator offline: the first operator is closed, then a signer that `openDeals` reopens from the key store reports `deliverBy-passed` and `refunded`; its 1 reclaim request went to the second operator, which shows `Refunded` and the full balance.
  3. Restarts: run 1 stops inside the `deliverBy-passed` report and sends nothing; `openDeals` lists the deal. Run 2 sends the reclaim, its answer is lost, it reads the deal again, finds it `Refunded`, and stops inside the `refunded` report. Run 3 reports `refunded` once more and sends nothing. In all: 1 reclaim request, 1 `settlement.reclaimed` event on each operator, and `openDeals` empty.
  4. Release: `watch` reports `released` once and sends no reclaim; `openDelivery` then returns the work and reports nothing more.
  5. Refund by decision (work that fails the checks): `openDelivery` reports `refunded` with `reclaimed: false`, sends no reclaim, and the balance is 10,000 tUSD less the 1 tUSD fee.
- `pnpm exec vitest run examples/buyer-signer.test.ts` (T-319's tests, unchanged): 6 pass in 3.7 s. `examples/buy-with-signer.ts` is 20 lines and now prints each report on stderr.
- `pnpm exec vitest run examples`: 21 files pass, 185 tests pass, 13 skip (the anvil and network suites, which CI runs) in 122 s.
- `pnpm typecheck`: passes. `pnpm lint`: passes with no finding.
- `node site/build.mjs && node site/check.mjs`: site check PASS. `site/try.mjs` keeps its SHA-256 (`4dab4c08…`); `site/index.html` does not change.
- Snapshot diffs: none. Metrics: none.
- Not run: the full `pnpm verify` (Change recipes: only before a deploy). CI is the gate.

### Review fixes (roadmap row N75, 2026-11-11)

An independent review of PR 307 found 1 High, 1 Medium and 4 Low findings, all inferred from reading the code; T-324 added a seventh item. Rafa, 2026-11-11: "Yes, fix all three" (the day's High findings). Branch `t-325-review-fixes`, from `origin/main` at `d774a1e`. Each code finding got a failing test first, run on the unfixed signer (measured):

1. **High: one operator's answer became the permanent outcome. Reproduced.** With operator B silent and operator A reporting a false `Refunded`, the unfixed `watch` returned `Refunded` while the deal was `Held`. The one-operator-offline test returned an outcome from one answer too. Fix: an outcome is final, and saved, only when `confirmations` operators (default: every configured operator, D31) report it and none reports another state. Until then `onReport` gets `unconfirmed` with `agreeing`, `answered` and `required`, `openDeals` keeps the deal, and the reclaim stays armed. Test: the lying operator is reported as `unconfirmed` (1 of 1 answering, 2 required); once B returns and `deliverBy` passes, the reclaim goes to B alone and the deal ends `Refunded` with 1 `settlement.reclaimed` event per operator. The offline test now ends `unconfirmed` by default and settles with `confirmations: 1`.
2. **Medium: one operator could switch the reclaim off. Reproduced.** An operator that answered the reclaim 200 and relayed nothing left the deal `Held`, and the unfixed signer waited until the test's 60 s limit. Fix: while the deal stays `Held` `reclaimRetryMs` (default 120 s) after a 2xx, the next operator gets the reclaim under a fresh key, in the same run or after a restart. The reclaim goes to each operator that reports `Held`, so a disagreement no longer stops it. Tests: in one run (reclaims to A, then B), and across a restart with the answer saved and no outcome (A in run 1, B in run 2); 1 `settlement.reclaimed` event per operator in each.
3. **Low: the fastest clock decided the missed deadline. Reproduced.** With A's clock 1 h ahead, the unfixed signer reported `deliverBy-passed` before the deadline. Fix: the slowest answering clock decides the report, the fastest the reclaim (which settlement refuses while early). Test: no report before the deadline; afterwards one report, on the slow clock, and the refund.
4. **Low: `site/llms.txt` overstated.** Not code: the lines now say settlement refunds the hold once, however many operators get the reclaim, and describe the quorum and the watch file.
5. **Low: the comment and this task's Context said refusals replay.** Confirmed by reading `apps/operator/src/idempotency.ts:37` (only answers below 300 are stored). The comment, Context and Decision 2 are corrected, and the signer no longer changes the key after a refusal.
6. **Low: the watch state sat in the key file. Reproduced.** The unfixed signer rewrote the key file with a `watch` record. Fix: `<address>.watch.json` beside it; the test checks the key file is byte-for-byte unchanged across two runs, and the watch file holds no secret key.
7. **From T-324: the quote credential.** `Options.quoteCredentialEnv` names an environment variable; `quote` sends `Authorization: Bearer <value>` and saves, returns and logs nothing of it. A named variable that is unset stops before any request, naming the variable only. `examples/buy-with-signer.ts` uses `CROW_QUOTE_CREDENTIAL` when it is set. Test: 401 without the credential, the named-but-unset error, a quote with it, and the credential in no file of the key store and not on the signer.

After the fixes (measured): `examples/buyer-signer-outcome.test.ts` 9 pass and `examples/buyer-signer.test.ts` 7 pass, 16 tests in 15.2 s. `pnpm exec vitest run examples`: 22 files pass, 235 tests pass, 13 skip (the anvil and network suites) in 127 s. `pnpm typecheck` and `pnpm lint` pass. Site check PASS; `site/try.mjs` keeps its SHA-256.

Not changed: `vitest.config.ts` still counts `examples/buyer-signer-outcome.test.ts` at 5 s; it now takes about 15 s locally. The new tests sit in `examples/buyer-signer-outcome.test.ts`, T-325's own test file, which the review's path list did not name. Inferred, not measured: on Sepolia the operators' own timeout pass may land the reclaim first; the signer then reads `Refunded` on every operator and sends nothing more.
- Inferred, not measured: the reclaim works the same on Sepolia. The trigger route and the `settlement.reclaimed` event are the same on both settlement layers (`packages/settlement/evm/evm-settlement.ts`), and there the operators also send the reclaim themselves a minute or two after `deliverBy`; whichever lands first, the other answers 200 or 409 and nothing moves twice. No test here runs on a chain.

## Decisions

1. **The reclaim carries no signature, because the protocol defines none.** The task asked for a reclaim signed with the buyer's key. The API's reclaim is a timeout trigger: anyone may send it once `deliverBy` has passed, with `{}` and no signature, and the settlement layer checks the deadline (`spec/openapi/paths.json`; `site/llms.txt`, "Your own trigger"). A signed reclaim would be a new message type, an API contract change through an ADR, outside this task's paths. So the signer sends the trigger from the buyer's machine, with an `Idempotency-Key`, and no operator authors anything: the deadline in the terms both parties signed is the authority. The direct path from the buyer's key to the contract (the escape hatch) needs ETH on the per-deal key and stays out (Handoff).

2. **One key per reclaim; a fresh one only after a 2xx that came to nothing.** An operator stores only answers below 300 (review fix 5), so a refusal is not replayed and the next operator gets the same key. After a lost answer the signer keeps the key, reads the deal again first, and starts the next try at the next operator. After a 2xx with the deal still `Held` past `reclaimRetryMs`, the next operator gets a fresh key, since the first replays its 2xx for the old one.
3. **Acting on the operators that answer.** `watch` acts when every operator that answers reports the same state, and goes on with one. Before signing, `checkOffer` and `agreeAndFund` still need every operator to agree. The connection now accepts a domain every answering operator names, and it must still be a pinned one. The reclaim needs no trust in an operator: settlement checks the deadline.
4. **Reports are at least once.** A report is recorded after `onReport` returns, so a run that stops inside it makes it again next time. The outcome is recorded before its report, so the next run returns it without reading the operators.
5. **`openDelivery` no longer stops after 10 minutes.** It waits as long as the terms say (D31), as `watch` does; `timeoutMs` is the caller's.
6. **The state lives in the key file.** No new state file and no `.gitignore` line: the key store the caller names already holds one file per deal, with mode 0600.
7. **A new test file on `startSimWorld`.** The T-319 tests run on the public demo's world, which has a timeout pass of its own. The sim world has none, so every reclaim in the new file is the signer's.

## Handoff

**Done.** `watch`, `openDeals`, the `Report`, `WatchOptions` and `Outcome` types in `examples/buyer-signer.ts`; `openDelivery` watches first; `examples/buy-with-signer.ts` prints the reports; `examples/buyer-signer-outcome.test.ts`; one cost line in `vitest.config.ts`; the buyer signer's section in `site/llms.txt`. The site deploy that publishes the section waits for Rafa.

**Not built, with the reason.**

1. **A reclaim signed with the buyer's key.** The protocol's reclaim takes no signature (Decision 1). A signed variant would be an API contract change through an ADR.
2. **The direct reclaim from the per-deal key to the contract** (the escape hatch): it needs ETH on that key. With every operator offline the signer waits.
3. **`examples/agent.ts` is unchanged.** `Agent.trusted` and `Agent.settlementNow` need every operator, so the signer reads with its own `#answers` and `#agreed`. `Agent.openDelivery` reads from its first operator; the signer builds one with an answering operator first. The ciphertext still comes from the URI the delivery records, so a release cannot be opened while that operator is offline.

**Follow-ups** (also in `reports/scratch/t-325-triage.md`):

4. Done in the review fixes: the next operator gets the reclaim, under a fresh key, when the deal stays `Held` after a 2xx (`reclaimRetryMs`).
5. Done in the review fixes: `confirmations`, every configured operator by default.
- Refresh the `vitest.config.ts` cost of `examples/buyer-signer-outcome.test.ts` (about 15 s now, counted at 5 s) at the next cost-table refresh.
6. The Python signer and Delegation admission (roadmap row N38).

**How to resume.** `pnpm install && pnpm build && pnpm exec vitest run examples/buyer-signer-outcome.test.ts examples/buyer-signer.test.ts`. The surface is the header comment of `examples/buyer-signer.ts`.
