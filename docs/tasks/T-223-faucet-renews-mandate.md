# T-223: The demo faucet renews an address's mandate

- **Lane:** demo (the operators' faucet in `apps/demo-cloud`)
- **Phase:** 5
- **Depends on:** T-222 (merged in PR 179, deployed on 2026-11-04 per PR 188), whose standing test seller keeps one address for more than 30 days.
- **Paths this task may touch:** `apps/demo-cloud/src/world.ts` (`grantFrom` and its `FaucetLedger`), `apps/demo-cloud/src/world.test.ts`; docs: `docs/backlog.md` (its row), `docs/decisions-today.md` (D47's open item), `docs/operations.md` (the test seller's mandate paragraph), `docs/api.md` and `site/llms.txt` (the faucet sentence; `node site/build.mjs` leaves `site/index.html` and `site/try.mjs` unchanged), `docs/plan.md` (this row), `docs/tasks/T-222-test-counterparties.md` (its Handoff item 1), this file.
- **Human gate:** yes for the deploy: the two operator Workers run the fix only after Rafa deploys them. Everything else is in the repository.
- **Status:** done (merged in PR 191; it goes live with the next operator deploy, on Rafa's go-ahead, listed in the daily log's "Waiting on Rafa")
- **Agent/session:** faucet renewal session, 2026-11-04, started from the T-222 session

## Intent

Before this task, `POST /v1/faucet` reused whatever mandate it found for the address in `demo-club`, expired or not. Core refuses an offer or an agreement under an expired mandate (`mandate_expired`, `packages/core/src/state.ts:158`). So an address kept for more than 30 days could never deal again, and the faucet answered with the dead mandate. Crow's standing test seller (D47, T-222) is such an address.

The goal: a faucet grant always leaves the address with a live 30-day mandate in `demo-club`. Unchanged: the per-address hour, the per-client limit, the daily mint cap, and no mint for an address that already holds the grant amount. Non-goals: a renewal route of its own, longer mandates, and any change to how settlement checks a scope.

## Context

- D47 and its research note, `docs/research/2026-11-04-test-counterparties.md` (finding 2, and "The faucet dependency").
- `apps/test-agents/src/seller.ts:463` (`ensureMandate`): the seller treats a mandate as live only while it has more than 2 × `deliverWithinSec` (2 × 3,600 s) left, and calls the faucet otherwise.
- `SimChain.admit` (`packages/settlement/sim/simchain.ts:306`) and `EvmSettlement.admit` (`packages/settlement/evm/evm-settlement.ts:385`) key mandates by agent and club in a map, so a later mandate replaces the earlier one. A restore applies saved mandates in order, so the latest wins.

## Acceptance criteria

- [x] Test first, in `apps/demo-cloud/src/world.test.ts`: a world on a controlled clock grants a mandate; at its expiry an offer from the address fails `mandate_expired`; a second grant returns a mandate that expires 30 days later; the address then offers (`Offered`).
- [x] A grant two hours before expiry also returns a fresh 30-day mandate, the test seller's case.
- [x] A deal offered before both parties renew still agrees and funds to `Held`.
- [x] Both nodes, and a world rebuilt from the same storage, serve one mandate for the address: the latest.
- [x] The per-address hour, the per-client limit, the daily mint cap and the "already holds the grant" path are unchanged; their existing tests pass.
- [x] The backlog row "The faucet does not renew an expired mandate" is gone, and D47's open item points here.
- [x] `pnpm verify` passes.

## Out of scope

- The deploy of the operators (Rafa's gate).
- The test seller's own degraded message (`seller.ts:477`, T-222's lane). After the deploy it shows only if the faucet fails to renew.

## Evidence

- Commands run and results:
  - Red first (measured): with only the test added, `pnpm vitest run apps/demo-cloud/src/world.test.ts -t "renews"` failed at the renewal check: the grant after expiry returned the same `mandateHash`. The `mandate_expired` refusal before it passes on the old code too, as it should.
  - Green (measured): `pnpm vitest run apps/demo-cloud/src/world.test.ts`: 22 of 22 tests pass. After review the test also offers a deal, renews both parties, then agrees and funds it to `Held`.
  - The chain world (measured): `pnpm vitest run apps/demo-cloud/src/live.test.ts` on anvil passes 2 of 3 tests in 24 s, the faucet's mint included: the deal reaches Released and the world reopens from storage. The Sepolia-fork test skips: it needs `SEPOLIA_FORK_RPC`.
  - `pnpm verify` on 2026-11-04 at commit `67cd035`, rebased on main `ae2f75e` (measured): PASS. Typecheck, lint, forge build, forge (241 of 241 tests), test (2,504 passed, 3 skipped), spec, snap, snap:local and demo all pass. Report: `reports/verify-t-223-faucet-renews-mandate.md` (not committed). The report notes uncommitted changes: the Evidence and Handoff edits to this file, later committed as `8fa0bbf`.
  - `node site/build.mjs && node site/check.mjs` (measured): PASS.
- Snapshot diffs: none.
- Metrics: none.

## Decisions

- **Every grant signs a fresh mandate, live or not.** The brief and the research note asked to treat only an expired mandate as absent. That leaves the test seller degraded for about 2 hours every 30 days (inferred from `seller.ts:471` and `seller.ts:249`): it asks the faucet 2 hours before expiry, the faucet would return the same mandate, and the seller goes degraded for an hour, twice, until the old mandate expires. Re-signing on every grant has no margin to tune, and suits any agent whatever its deal windows.
- **Why re-signing is safe.** Settlement reads the scope at offer, agree and fund (`scopeFor`), and no deal binds a mandate's hash or `issuedAt` (inferred from the code). The new mandate has the same scope with a later expiry, so a deal in flight continues (measured: the test renews both parties between offer and agreement, and the deal reaches `Held`). The per-address hour still limits how often an address can ask. Each grant adds one mandate entry to storage, as a grant to a new address already does.
- **Accepted: a refused grant still renews.** `grant()` admits the mandate before the daily mint cap check, and neither a cap refusal nor a refused mint records the address's hour. So each such attempt renews the mandate and stores one entry, up to the per-client limit of 10 an hour per client. That is the bound a grant to a new address already had. The order stays: the cap's 429 tells an agent it can mint the tokens itself, which works only if it still gets the mandate.
- **Accepted: a renewal can make one trusted read fail.** `examples/agent.ts` `trusted` compares the operators' whole answers, so a renewal between two parallel reads of `/v1/agents/<address>` gives "operators disagree" once. The window is milliseconds, and the caller retries (inferred).
- **Noted for Phase 2: renewals share one nonce.** `mandateFor` (`packages/settlement/sim/actors.ts:112`) derives the nonce from the principal, agent and club, so every renewal carries the same one. Nothing reads mandate nonces today; revocation by nonce would revoke all renewals at once.
- `FaucetLedger.agentMandates` had no other caller, so it is removed.

## Handoff

- **Done in the repository:** the fix, its test and the docs listed above.
- **Not done: the deploy, Rafa's gate.** Until both operator Workers run this commit, the live faucet returns the address's existing mandate, expired or not, and `seed.mjs --replace` stays the stopgap for the test seller (`docs/operations.md`).
  - The test seller went live on 2026-11-04, so its first mandate expires about 2026-12-04, and the seller asks the faucet 2 hours before that (inferred from the deploy date and `seller.ts:471`). Deploy the operators before then.
  - Deploy the operators before or with the next site publish, since `llms.txt` now says each grant renews the mandate.
  - The deploy needs no new world: the fix changes no schema and no journal entry, so `WORLD_NAME` stays (D49, pending).
- **Overlap checked on 2026-11-04:** no open PR edits `world.ts`. T-221 merged in PR 184 without touching it. T-219 (todo) will touch `world.ts` only to hand a store to `LiveChain`.
- **Follow-ups outside this task's paths:**
  - A chain-world test that restores two mandates for one address (`packages/settlement/evm/wall.test.ts`). It is correct by reading `evm-settlement.ts:293` and the page order in `storage.ts` (review of PR 191).
  - `docs/tasks/T-222-test-counterparties.md` Handoff still says the deploy is not done, though PR 188 deployed it (T-222's lane).
- **To resume:** `pnpm vitest run apps/demo-cloud/src/world.test.ts -t "renews"`.
