# T-006: SimChain: escrow rules, permissionless triggers, two-sided key release, bonds

- **Lane:** settlement
- **Phase:** 1
- **Depends on:** T-004, T-014
- **Paths this task may touch:** `packages/settlement/sim/`, `packages/settlement/src/interface.ts`
- **Human gate:** no
- **Status:** done
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-006-simchain`

## Intent

Implement the `Settlement` interface in-process with the exact rules the contract will enforce, so the demo and fixtures run deterministically.

Restated (implementer, 2026-10-31):

SimChain is the in-process stand-in for the Phase 2 rules contract. It owns the facts core's pure `step` cannot know (balances, bond pools and their `reserved` counter, nonces, registered agents and clubs, the sim clock and the sim beacon), checks every submitted message's signature against those facts, runs `step`, and applies the resulting postings and events atomically or not at all. Anyone may submit a signed message or a permissionless trigger; SimChain never authors a party's message. Behind the `Settlement` interface it must give the demo a deterministic, replayable ledger: the happy path, early acceptance, fallback and default when an adjudicator is silent, escalation, a party appeal with its held fee, and a mutual settlement, each conserving value and settling once. `validate` is the same path without the commit.

Priority (Rafa's scope rule): honest parties until the basic demo works. The criteria the demo path needs are built; hardening that only matters against adversarial parties or later phases is recorded in `docs/backlog.md` with source T-006.

Non-goals: the EVM contract (Phase 2); `settle_after_window` and `optimistic` modes and `Dispute` handling (Phase 4); fees that follow an overturn (backlog, D21); kill fees on mutual settlement (Phase 1 share is 0); backer deposit and withdrawal messages (Phase 4; senior is exercised only by a synthetic deposit in tests); read authentication and private bodies (Phase 2; Phase 1 is `public` only); the operator API, receipts and HTTP idempotency headers (T-007), although SimChain keeps its own idempotency records so `validate` can be shown to leave them alone.

## Context

- `docs/architecture.md` §Hold and settlement postings, §Settlement interface, §Two-sided hold; ADR-0002, ADR-0007, ADR-0012, ADR-0014 §2a (bond pools), ADR-0017 (dry run), ADR-0018 (panel seed), ADR-0019 (mutual settlement); `docs/neutrality.md`.

## Acceptance criteria

- [x] All postings in the table implemented; settle-once guard; permissionless triggers (expire-offer, reclaim, fallback, default, appeal-expiry, settle).
- [x] Signature, scope, mandate, nonce, deadline checks on every submitted message (reuse T-004); member admission checked under club rulebooks.
- [x] Adjudicator acceptance gates funding: policy and registry hashes match, bond reserved (100% of price in guaranteed mode); an adjudicator that never accepts leaves nothing held.
- [x] Decisions are refused unless the seed is valid for the decider's role (primary: preimage of `seedCommitment`; fallback and appeal: the beacon seed for the round fixed by `judgeBy`, the escalation or the appeal filing, ADR-0018), the policy and registry hashes match, and the signer is the adjudicator whose turn it is.
- [x] SimChain beacon: `value(round) = keccak256(simSeed ‖ round)`, one round per simulated second, available only once the clock reaches it; supplied to core's `step` as a fact. An unprovable round refuses the decision; there is no substitute source.
- [x] Key release: decision accept carries key-for-buyer; stored and emitted atomically with release.
- [x] Bond pools per ADR-0014 §2a: `bond:{a}:junior` and `bond:{a}:senior` with one `reserved` counter; coverage gate `junior + senior - reserved >= price`; losses from junior first, then senior pro rata; appeal-upheld credit to junior; senior empty in Phase 1 with no deposit API, exercised by a synthetic deposit in property tests.
- [x] Bonds and coverage-ratio gate (100% per guaranteed commitment open to appeal; encumbered bond never counted twice); overturn payouts in guaranteed mode; default-outcome compensation, including the default after an escalation times out (appeal adjudicator's bond).
- [x] Fee routing per the postings table: the fee goes to the adjudicator whose decision settles; early acceptance returns the fee to the buyer; appeal fee held at filing, paid to the appeal adjudicator on its decision, returned to the appellant on expiry (D21).
- [x] Early acceptance releases the seller-supplied key for the buyer with the payment.
- [ ] (deferred to `docs/backlog.md`, T-202) Model `authorizationExpiry` so SimChain and the Phase 2 contract agree (differential tests).
- [x] fast-check properties: conservation, non-negative balances, settle-once, idempotent resubmission, random interleavings of triggers.
- [x] Hash-chained event log with replay.
- [x] `Settlement.validate(...)` runs the same guards as submission against the settlement layer's own facts and changes nothing (ADR-0017 §7). Party messages may be unsigned and report the skipped signature check; adjudicator messages and triggers must be signed. Property test `error.dry-run-has-no-effects`: state, nonces, idempotency records, reserved bond and events are unchanged.
- [x] Mutual settlement (ADR-0019): `mutual_settle` event with both signatures over the same struct; guards (funded and undecided state, signers equal buyer and seller, `deliveryHash` matches or is null in Held, `releaseKey` only with a delivery, rulebook allows); D23 guards via core's `mutualSettlementProblem` (payouts sum to the price exactly, every payout in the price token, `payoutsTo` honored); one posting per payout, fee to the buyer, key only to the buyer; postings per the table; reservations released; settle-once race with a decision, first applied wins (property test).
- [x] `pnpm load`: 1,000 holds, report p50/p95 (measured); 100 concurrent holds on one balance, zero overdrafts.
- [x] Integer rates (ADR-0022): every rate applied to money uses core's `mulBps` or `splitBps` with the rounding rules (requirements ceil; splits floor with the named remainder claimant; bond payouts floor, dust kept); a property test checks conservation across every posting.
- [x] (partly; `Dispute` guard and every-event hashes deferred, see Handoff) Privacy (ADR-0020): SimChain holds the fallback and appeal key envelopes and releases each only on takeover; `escalate` decisions must carry the appeal adjudicator's envelope and `Dispute` must carry envelopes for all three adjudicators; every event carries `termsHash` and `recordHash`, with bodies only at disclosure levels that publish them (Phase 1: `public` only).
- [x] Finality (D20): compute `settledAt` and `finalAt` for the read model from `step` output and the sim clock; `finalAt` is set once `appealBy` passes with no appeal, without waiting for a trigger.
## Out of scope

- EVM contracts (Phase 2).

## Evidence

Labels: measured (I ran it and saw the output), inferred (follows from code I read), guessed.

- **Baseline** before any change: `pnpm typecheck` clean, `pnpm test` 1008 passed (measured).
- **Test first** (measured):
  - core: the new `state.test.ts` rows failed to load before the change (`panelSeed`, `beaconRoundFor`, `deliveryHash` missing); after the D23 merge, 10 mutual-settlement rows failed until `step` took payouts; 211 pass after.
  - settlement: 28 of 28 path tests failed against a placeholder `SimChain` (commit "test(settlement): specify SimChain paths..."), then all passed on the first implementation run.
- **Suite now:** `pnpm test` 1543 passed; `pnpm typecheck` and `pnpm lint` clean; `pnpm snap` 1 passed (measured). Final `pnpm verify` result is in the PR.
- **Properties** (fast-check, seed 20261031, measured): 120 random interleavings over three deals sharing adjudicators with random prices, rates and a synthetic senior tranche; 483 submissions applied and 2,187 refused; after every action: conservation, no negative balances, settled once, reserved counter = sum of reservations ≤ junior + senior, escrow empty when terminal, appeal accounts empty when no appeal is open, nothing reserved once unappealable; same-key resubmission replays and a bare resubmission is refused, both with an unchanged digest; `validate` leaves the digest (ledger, commitments, nonces, reservations, spend, idempotency records, log head) unchanged; the log verifies and the journal replays to the same digest. Plus the settle-once race in both orders (20 runs, concurrent submission), the junior-then-senior waterfall, and default payouts rounded down (15 runs).
- **Mutation sweep** (measured, scratch script `t006-mutate.mjs`): 16 mutants of key guards. First run: 14 killed, 2 survived (overdraft guard; payout cap by reservation). After two new tests: 16 of 16 killed. Mutants: beacon round check, panel seed check, D23 payout checks, nonce reuse, overdraft, early beacon, idempotency body compare, dry run commits, payout cap, acceptance reserves no bond, all envelopes at delivery, early accept keeps reservations, appeal fee not held, accept without key, escalate without appeal envelope, finalAt before appealBy.
- **`pnpm load`** (measured on this machine): 1,000 holds (3,000 submissions, pre-signed) in 7.36 s; per submission p50 2.48 ms, p95 3.35 ms; per hold p50 7.24 ms, p95 8.27 ms; 4,000 events, log verifies. 100 concurrent holds on a balance covering 37: 37 funded, 63 `insufficient_funds`, buyer left 0, 0 overdrafts.
- **Fixtures:** `_example` now runs on SimChain. Its snapshot diff is 3 lines: the settlement label, one more event (the primary's envelope released at delivery) and the chain head; timeline, balances and invariants are unchanged (measured, reviewed diff).
- **Schema conformance:** every event in a full appeal path parses with `parseEvent`, and the read model with `parseCommitmentState` (measured, `simchain.test.ts`).
- **Atomicity** (inferred from code): each submission runs in one `Tx` overlay committed in one synchronous block after async signature checks; submissions are queued, so concurrent callers cannot interleave between a balance check and its posting. The load test's concurrent case confirms it for funding (measured).

## Decisions

1. **Core changes made here** (out of lane; ADR-0018 and ADR-0019 assign them to `state.ts`): `beaconRoundFor`, `panelSeed`, the per-role seed check with the beacon as a fact on `decide`, `openedAt` on an open appeal, `mutual_settle` with the terminal `Settled` state, and `deliveryHash` in `eip712.ts` (domain-free struct hash of the unsigned delivery, like the commitment ID).
2. **Beacon rounds are Unix seconds.** Fallback round = `judgeBy` seconds; appeal round = seconds of the escalation or appeal filing, plus one. A round is available once the clock reaches it. An unavailable round gives no beacon fact, and core refuses with `seed_mismatch`.
3. **Reservations.** The primary reserves the price at acceptance (`mulBps(price, 10000, 'ceil')`). The fallback (at takeover) and the appeal adjudicator (at escalation) reserve up to the price from what is free, since a permissionless takeover cannot be refused (shortfall stays backlog item F5). A decider keeps its reservation until its appeal closes; escalation releases the primary's and fallback's; every terminal path without an open appeal releases all. A payout from a pool never exceeds that commitment's own reservation, so one commitment's payout cannot draw another's encumbered units.
4. **Default after fallback silence** pays compensation `floor(price × sellerCompensationRateBps / 10000)`, split evenly: the fallback pays the half rounded down (`splitBps` share), the primary the remainder. Recorded as a backlog item for a rulebook term.
5. **Fees** land in the adjudicator's own account (`{address}`), not its bond. A party appeal's fee sits in `appealfee:{id}` until decided or expired (D21).
6. **Key envelopes** (ADR-0020): delivery releases only the primary's; fallback takeover releases the fallback's; escalation releases the one the decision carries; a party appeal releases the appeal adjudicator's; the buyer's is released by early acceptance or a settlement with `releaseKey`, and a decision accept must carry `keyForBuyer`.
7. **Mutual settlement** follows D23 (`payouts`): core calls `mutualSettlementProblem` with the rulebook's `mutualSettlement` as a fact; SimChain posts one payout each and re-checks the sum; the fee share uses `splitBps` (0 bps in Phase 1, remainder to the buyer).
8. **Nonces** are checked before the state guard, so a resubmitted message reports `nonce_reused`. Offer nonces are scoped `{seller}:terms:{nonce}`, settlement nonces `mutual:{id}:{nonce}`.
9. **Facts from genesis.** Mandates (signed by principals, verified once), club rulebooks, closed-club members, balances and bonds come from a `Genesis`. The only run-time admin surface is the test faucet and the clock, both journaled for replay.
10. **`validate` and triggers.** Triggers carry no signature, so they are validated as they are; adjudicator messages must be signed; a party message with a missing signature reports `signatureCheck: 'skipped'`.
11. **The `settle` trigger** is refused (`invalid_state`) in guaranteed mode; the testkit keeps its own no-op `settle` step.
12. **Testkit wiring**: the driver keeps the name `StubSettlement`, now submitting to SimChain. Adjudicator faucet amounts become junior bond, and the balances table shows an adjudicator's balance plus bond, so `_example`'s balances are unchanged.

## Handoff

**Done:** every criterion except `authorizationExpiry` and two privacy sub-items (see below). PR opened against `main`.

**Out-of-lane files** (each needed for the task; owners should review):
- core: `packages/core/src/state.ts`, `state.test.ts`, `eip712.ts` (Decisions 1 and 7).
- testkit: `packages/testkit/src/stub-settlement.ts`, `render.ts`, `package.json`, `tsconfig.json`; `fixtures/scenarios/_example.expect.md` (regenerated, reviewed); `fixtures/README.md`.
- root: `package.json` (`load` script), `vitest.config.ts` (include `packages/settlement/sim/**/*.test.ts`), `pnpm-lock.yaml`.
- docs: `docs/backlog.md` (T-006 rows), `docs/team.md` (proposed mutation-sweep check), this task file.
- settlement package config: `packages/settlement/package.json`, `tsconfig.json` (rootDir `.` so `sim/` builds; exports `.` and `./sim`).

**Deferred** (all in `docs/backlog.md` with source T-006): `authorizationExpiry` and differential tests (T-202); run-time agent registration, revocation and member admission; persistence; releasing a reservation when `appealBy` passes untriggered; the `Dispute` envelope guard (Phase 4); `termsHash`/`recordHash` on every event (needs a schema bump); replaying refused results; a rulebook term for the default split.

**For T-007:** use `@holdback/settlement` (`Settlement`, `Submission`, `DryRunSubmission`) and `@holdback/settlement/sim` (`SimChain`, `Genesis`). `submit(…, { idempotencyKey, via })` already gives replay and 409-style `idempotency_conflict`; `validate` is the `?validateOnly=true` path; `state(id)` returns a schema-valid read model with `settledAt` and `finalAt`.

**For T-010:** `Deal` in `sim/actors.ts` builds every signed submission, including adversarial ones (wrong seed, missing key, missing appeal envelope, impersonating signer). The testkit step set has no `appeal`, `early_accept` or `mutual_settle` steps yet, so those fixtures need T-005/T-010 step kinds.

**Open question:** the default-after-fallback split (Decision 4) is my choice, not a decided rule.
