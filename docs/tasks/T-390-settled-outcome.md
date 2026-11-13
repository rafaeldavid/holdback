# T-390: a deal that ends Settled finishes in the buyer's tools and adds up in the deal record

- **Lane:** demo (client tools)
- **Phase:** 2
- **Depends on:** T-379 (the buyer signer and the deal record with the two addresses, merged to `contracts-audit-ready` at `100cde3`), T-378 part 4 (the late-work settlement route, rafaeldavid/holdback#408), T-387 (the pilot kit's rehearsal, which found both defects)
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, `examples/deal-record.ts`, their tests, this task file. Never `packages/settlement`
- **Human gate:** no
- **Status:** done on the merge of its third pull request (part 3, bundle-safe commands)
- **Agent/session:** the T-379 session, change kind 4: one reviewer

## Intent

In my own words. A deal can end three ways, and the buyer's tools know two. A mutual settlement, with late work or as any split of the price, ends `Settled`. T-387 measured both gaps on a phase-one `pnpm sim` at `e4e930c` (`t-387-defects.md` in the shared notes):

- **The buyer's command never returns.** `watch()` in `examples/buyer-signer.ts` waits for `Released` or `Refunded`, so `buy-with-signer.ts resume` polls a settled deal for ever. `Settled` becomes a final outcome, recorded only when every configured operator agrees, as the other two are. When the settlement released the key, the buyer opens the work and checks both hashes. When it did not, the tool says so and opens nothing. Either way the outcome line names the settlement's payouts.
- **The deal record fails a check that holds.** `examples/deal-record.ts` conserves the hold from the `postings` of the settling event. SimChain's `commitment.settled` carries `payouts` and no postings, so "postings conserve the hold" fails, and `paidTo` comes out null, although the payout address was paid. The EVM adapter's event has the same `{payouts, keyReleased}` shape, and none of its events carries postings [measured by reading `packages/settlement/evm/evm-settlement.ts:1538-1554`]. So the record conserves the hold from the payouts where there are no postings: they sum to the price, and the adjudication fee returns to the buyer's payment address, less the sitting adjudicator's rulebook share. It names who was paid from them. Where an event carries no postings and no payouts, as a chain's release or refund does, the postings checks are marked not run, not failed.

Non-goals: no change to SimChain's or the EVM adapter's events (the record reads both shapes); no settlement command for the buyer (it signs a settlement through the API or its own tools).

## Context

- `t-387-defects.md` (shared notes): the reproduction.
- `packages/settlement/sim/simchain.ts:935-970`: what a settlement moves (one posting per payout, the fee share, the fee back to the buyer's payment address) and what `commitment.settled` carries.
- T-378's late-work route (rafaeldavid/holdback#408): the settlement carries the unposted delivery; `key.released` follows with path "mutual settlement"; no `delivery.submitted`.

## Acceptance criteria

- [x] `watch()` ends on `Settled` when every configured operator reports it, and returns the payouts and whether the key was released; an `unconfirmed` report covers `Settled` too.
- [x] `openDelivery()` on `Settled` with the key released opens the work and checks the ciphertext's and the plaintext's hashes: from the posted delivery when there is one, and for late work from the delivery the seller handed over (`--delivery <file>` on `resume`), checked against the seller's signature and the released envelope. Without the key released, or without the handed-over delivery for late work, it opens nothing and says why.
- [x] `buy-with-signer.ts resume` returns with exit status 0 and an outcome line naming the payouts, for a settlement with the key released, one without, and a late-work settlement. The script stays at 50 lines or fewer.
- [x] The deal record conserves the hold from a settlement's payouts, names `paidTo` and `refundedTo` from them, and marks the postings checks not run for an event with neither postings nor payouts. Tests on SimChain's shape and on the chain's shape.
- [x] `pnpm typecheck`, `pnpm lint`, the touched tests and `pnpm snap` pass; CI passes.

Part 2 (the coordinator, 2026-11-12, from T-388's review of the buyer signer, finding H1)

- [x] `readOffer` compares the offer's `createdAt` with every configured operator's settlement time and lists a `createdAt` difference when it is outside the band `verifyPrepared` already holds a prepared offer to (600 s behind, 60 s ahead; one constant, `CREATED_AT_BAND` in `examples/verify.ts`), and a `settlementTime` difference when the operators' clocks are further apart than the band. `checkOffer` keeps the verdict made when the offer was shown.
- [x] A difference stops the one-run buy (`--expect-terms`) for approval: nothing is refused (D31).
- [x] Every approval stop shows `createdAt` and each deadline as a date and its distance from now (`timeline`).
- [x] Tests, failing first: postdated five years and backdated beyond the band each stop with exit status 3 and fund nothing; inside the band funds as before; one end-to-end run on the local world.
- [x] One reviewer and one red team on part 2, because it decides when an unattended buyer pays.

Part 3 (the coordinator, 2026-11-12, from T-393, the short guides): the buyer's commands can be published as one pinned file, as `site/try.mjs` is

- [x] A file runs its main only when it is the program, also inside a bundle that inlines it: `isMain(import.meta.url, name)` in `examples/entry.ts`, true unbundled when `node` was given the file, and in a bundle only for the command the bundle declares as `globalThis.crowEntry`. `examples/deal-record.ts` uses it, so `buyer-signer.ts`'s import of it runs nothing.
- [x] One place says how a command names itself and its siblings: `command(name, import.meta.url)`, the bundle's words from `globalThis.crowCommands`, else `node <path of examples/<name>.ts>` as before. The buyer's command's approve and fund lines, the signer's `check` line and `pay-from-wallet.ts`'s resume line use it.
- [x] Tests for both, with the unbundled behaviour unchanged. One reviewer; no red team.
- [x] `examples/try.ts`'s closing line is true of the world it ran on (the coordinator, from the cutover rehearsal): with the terms' appeal window at 0, as phase one requires, it says the decision is final; it names the appeal window, with the terms' own length, only when the terms have one. `site/try.mjs` changes with it.
- [x] The comments that named old `site/llms.txt` sections name the files T-393 moved them to (PR 444): `buyer-signer.ts` names `site/ref/signing.txt`, `site/ref/after-funding.txt`, `site/buy.txt` and `site/ref/http-buyer.txt`; `pay-from-wallet.ts` names `site/ref/http-buyer.txt`; `try.ts` names `site/ref/intake.txt`.

## Out of scope

- SimChain's and the EVM adapter's event payloads.
- The chain's Transfer logs as a source for the record's postings (Handoff).

## Evidence

Labels: measured, inferred, guessed.

- **Commands run, on the lane at `690edfd` plus this branch** [measured]: `pnpm typecheck` passed; `npx eslint examples site tests` passed; `pnpm exec vitest run examples/ tests/cut-feature-alignment.test.ts` passed 398 tests in 32 files (23 skipped); `pnpm snap` passed 43 of 43, no snapshot diff; `node site/check.mjs` passed, and the site files did not change.
- **The buyer's tools** [measured, `examples/buyer-signer-settled.test.ts`, 3 tests, on demo-cloud's world in phase one]:
  - A settlement after a posted delivery, with the key released: `watch` reports `settled` and returns `Settled` with the key released; `buy-with-signer.ts resume` exits 0, prints the payouts, and opens the work.
  - A settlement that releases no key: `resume` exits 0 with the payouts, `work: null` and the note "the settlement released no key: there is no work to open".
  - A late-work settlement: `resume` exits 0 and asks for the handed-over delivery; with `--delivery <file>` it opens the work; with another signed delivery of the seller's it exits 1 ("the key the settlement released is not your envelope in the delivery you passed").
  - A judge that waits at a gate the test opens holds the rubric deal in judging after its delivery, so the parties can settle it first.
- **The deal record** [measured, `examples/deal-record.test.ts`, 1 new test and 3 new assertions]:
  - On SimChain's shape (a real late-work settlement): "postings conserve the hold" and "postings follow the outcome" pass, `paidTo` is the seller's payout address and `refundedTo` the buyer's payment address.
  - A release whose events carry no postings: on SimChain, which writes them, the postings checks fail closed [measured]. On a chain, whose events carry none, they are marked not run with the reason [inferred: the branch needs a pinned chain, which the local world does not have].
- **Review of PR 440** (reviewer subagent, Opus 5.5) [measured: its report]: PASS with three Lows. Fixed: "not run" applies only on a chain (Low 3); the late-work outcome names the handed-over delivery's `deliveryHash`, to compare with the settlement the buyer signed (Low 1). Left in the Handoff: Low 2 and the rest of Low 3.
- **Where the shapes come from** [measured by reading]: SimChain's `commitment.settled` is `{payouts, keyReleased}` (`packages/settlement/sim/simchain.ts:967`), and its postings for the payouts and the fee are made but not put in the event. The EVM adapter writes every payload "as SimChain writes it for the same step (without postings)" (`packages/settlement/evm/evm-settlement.ts:1538`), and `commitment.settled` there is `{payouts, keyReleased}` too (`:1553`).

### Part 2: the offer's clock

- **Failing first** [measured]: before the fix, the postdated run funded and SimChain then refused the funding (exit status 1, "outside the authorization validity window"); the backdated run exited 1; the band constant did not exist. On a chain, whose funding is valid from 0, the postdated run would have funded [inferred, T-388].
- **After the fix** [measured, `examples/buyer-signer-clock.test.ts`, 5 tests]: postdated five years and backdated by 720 s each stop with exit status 3, a `createdAt` difference, a `timeline` that reads "in 5 years …" or "… ago", and no hold; with both operators reporting a clock five years ahead and the offer postdated by as much, this machine's clock still stops the buy; an offer 10 s old funds. On the lane at `bf9c89b` plus PR 440 plus this branch, `pnpm exec vitest run examples/ tests/cut-feature-alignment.test.ts` passed 409 tests in 34 files; `pnpm typecheck`, `npx eslint examples site tests` and `node site/build.mjs && node site/check.mjs` passed. `site/try.mjs` changes, because `verify.ts` holds the band (SHA-256 `ec49d496…` after the review).
- **Red team of part 2** (red-team subagent, Opus 5.5, 8 attacks run in-process) [measured: its report]: ISSUES, one Medium, two Low, three Info; no single actor could make the one-run buy fund far deadlines. Fixed: the Medium, both operators lying about `settlementTime` together, by checking `createdAt` against this machine's clock too, and taking "from now" from it (`Options.clock`, default `Date.now`; the rehearsal's local world, whose clock its tests move, passes its own). Held [measured by the red team]: one operator lying by five years, one going silent, odd timestamp formats, `checkOffer` after time passes. Left in the Handoff: the two Lows and the Info.
- **Review of PR 446** (reviewer subagent, Opus 5.5) [measured: its report]: three Lows and two Infos; nothing blocks. Fixed: the stop line names clock differences apart from the terms' ("against the clock: createdAt (see timeline)"), the warning line states the distance first, the two doc comments sit above their own code again, and the Handoff names every file outside the paths and the local-chain case.

### Part 3: bundle-safe commands

- [measured, `examples/entry.test.ts`, 4 tests]: `isMain` is true for the file `node` runs and false for another; with `crowEntry` declared, only the named command is the program though every inlined file has the bundle's URL; `command` names a sibling by its path unbundled and by the bundle's words when declared; a child process that imports `deal-record.ts` as a bundle would (its URL as `process.argv[1]`, an entry declared) runs no main, and the same import with no entry declared runs it as before (exit status 2, its usage). `pnpm exec vitest run examples/ tests/cut-feature-alignment.test.ts` passed 413 tests in 35 files on PR 446's head plus this branch; `pnpm typecheck`, `npx eslint examples site tests` and `node site/build.mjs && node site/check.mjs` passed; `entry.ts` itself changes nothing in `site/try.mjs` (none of its three files uses it).
- **`try.ts`'s closing line** [measured, `examples/try.test.ts`, 7 tests]: every run's last line before the commitment now reads "…; final at the decision, since the terms have no appeal window", and no run prints "appeal window closes". `site/try.mjs` is rebuilt (SHA-256 `18204242…` after the review), so the site's command changes again on the next deploy.
- **The comment pointers** [measured, on the lane at `609cdd7` plus this branch]: no `examples/*.ts` file outside the tests names `site/llms.txt` any more, and each named section exists in its new file. Comments change nothing in `site/try.mjs`. `node site/build.mjs && node site/check.mjs`, `pnpm typecheck` and `pnpm lint` passed; `entry`, `try`, `deal-record`, `buyer-signer-clock`, `buyer-signer-settled` and `cut-feature-alignment` passed 34 tests in 6 files. `buyer-signer-addresses.test.ts` passed 15 of 15 run alone; run after the other server-heavy files in one pass, its first test times out and the rest meet the operators' rate limit (`rate_limited`), as on the lane with PR 446 merged and without part 3 [measured], so this branch does not cause it [inferred].
- **After the review of PR 451** (no High or Medium; four Lows, fixed) [measured, each file run alone, as the coordinator asked while the machine was loaded]: `entry.test.ts` passed 5 tests (a bundle that declares an entry but not a sibling names `node examples/<name>.ts`; a global inherited through `Object.prototype` counts for nothing); `try.test.ts` passed 8 (the finality clause, now `examples/finality.ts`, at a window of 0 and of 60 s and 86,400 s); `buyer-signer-addresses.test.ts` passed 15 (it now checks the `pay-from-wallet … fund` and `buy-with-signer … resume` lines it prints); `cut-feature-alignment.test.ts` passed 2. `pnpm typecheck`, `npx eslint examples site tests` and `node site/build.mjs && node site/check.mjs` passed. The whole suite runs in CI.

## Decisions

- **Part 2: the clock is judged when the offer is shown.** A `createdAt` grows older while an offer waits for an approval, so `checkOffer` keeps the shown verdict rather than judging again: a slow approval must not refuse a valid offer, and an approval cannot clear a difference the person was shown.
- **Part 2: the band is the one prepared offers already meet,** read from one constant in `examples/verify.ts`: an honest operator's `createdAt` is settlement time, so any honest offer is inside it.

- **The fix is in the record, not in SimChain's event.** Both settlements write the same `{payouts, keyReleased}`, and a chain writes no postings for any outcome, so the record reads the payouts for a settlement and marks the postings checks not run where an event carries neither.
- **Late work opens from the delivery the seller handed over,** passed with `--delivery`, because no operator records it as a delivery. It opens only if the seller's signature recovers, the released envelope is the buyer's own in it, and both hashes match.
- **`Settled` is final only when every configured operator reports it with the same payouts and key release;** a disagreement keeps the deal unconfirmed, as for the other outcomes.

## Handoff

- **Outside the listed paths:** `examples/audit-deal.ts` gains `'Settled'` in two type unions (its outcome and `EndState`), a type-only change the wider `Delivery.outcome` needs; the rehearsal makes no settlement.
- **For the record on a chain:** a release's or refund's money is in the token's Transfer logs, which the record does not read; its postings checks say so and are not run.
- **Part 2, left from its red team:** one operator whose clock is 600 s to 660 s off stops every one-run buy for approval (Low; the approve path still works), and the 660 s spread it allows is looser than the 5 s that funding then requires (`examples/agent.ts`, `settlementNow`), which fails closed. An offer postdated inside the band (up to 60 s) is refused by SimChain until `createdAt` passes (Low; no money moves). `fromNow` counts 365-day years and is computed when the offer is shown (Info). A machine whose own clock is off by more than the band stops honest offers for approval.
- **Part 2, outside the listed paths:** `examples/audit-deal.ts`'s `LocalWorld` gains `now()`, and the rehearsal passes it to the signer as its clock. `examples/verify.ts` holds `CREATED_AT_BAND`, so `site/try.mjs` and `site/index.html` change with it: the next site deploy changes the public try command (its SHA-256 goes from `1b5187d9…` to `ec49d496…`) because of that constant and the moved comment.
- **Part 3, for T-393:** a bundle of the buyer's commands sets, in a banner that runs before its modules, `globalThis.crowEntry` (the one command it runs) and `globalThis.crowCommands` (how a person runs each command it holds, such as `{ "buy-with-signer": "node buy.mjs", "pay-from-wallet": "node buy.mjs pay" }`). The other `examples/` files keep their path-comparison guards; only the buyer's path is made bundle-safe here. Three things the bundle must do [from the PR 451 review]:
  - **One command per entry.** `buy-with-signer.ts` and `pay-from-wallet.ts` run their top-level code on import, with no `isMain` guard, so a file that imports both statically runs both: `node buy.mjs pay fund …` would also run the buyer's command, which refuses its arguments. A file that holds both needs a dispatcher that removes `pay` from `process.argv`, sets `crowEntry` and then imports the one command dynamically (rolldown `inlineDynamicImports`); the reviewer bundled one and both commands ran [measured, PR 451 review].
  - **Declare every sibling it prints.** `buy-with-signer` prints the `pay-from-wallet` command when `CROW_PAYMENT_ADDRESS` is set, and `pay-from-wallet` prints the `buy-with-signer` one. A bundle that declares an entry but leaves a command out of `crowCommands` prints the repository's path, `node examples/<name>.ts`, which runs only from a checkout.
  - **Set the globals on `globalThis` itself.** `entry.ts` reads only the bundle's own properties, never ones inherited through the prototype chain.
- **Part 3, outside the listed paths:** `examples/entry.ts`, `examples/finality.ts` and their tests (`entry.test.ts`, and a unit test in `try.test.ts`); `examples/pay-from-wallet.ts` (its resume line, and the comment's pointer); `examples/try.ts` (its closing line, and the comment's pointer) and `examples/try.test.ts`; `examples/buyer-signer-addresses.test.ts` (it now checks the two printed command lines); `site/try.mjs` and `site/index.html` (rebuilt, because `try.ts` changed).
- **Part 2, a local chain:** on an anvil world the operators' settlement time follows the scenario's clock, not this machine's, so every one-run buy against it stops for approval [inferred, PR 446 review]. It fails safe; approve still works; no documented flow runs the buyer signer there. A test or tool that does passes its world's clock as `Options.clock`.
- **For T-387:** rerun the settlement cases; `resume` takes `--delivery <file>` for late work.
- **Left from the review:** no test makes the operators agree on `Settled` while serving different payouts, and the `unconfirmed` report then shows `agreeing` equal to `answered` (Low 2). The settlement branch of the record cannot see where the adjudication fee went, and `refundedTo` stays null when the whole price goes to the seller although the fee went back (Low 3). `#openLate` binds the handed-over delivery to the deal by the buyer's envelope; it does not check the settlement's `deliveryHash`, which no public read carries, so the outcome now prints the delivery's own hash for the buyer to compare (Low 1).
